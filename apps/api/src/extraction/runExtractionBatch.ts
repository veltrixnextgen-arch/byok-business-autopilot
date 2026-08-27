import Anthropic from "@anthropic-ai/sdk";
import type { InterviewAnswers, OrgChart } from "@byok/contracts";
import type { CostGate } from "@byok/cost-gate";
import { CUSTOMIZE_MODEL, customizationLogToDeltas, extractOrgChart } from "@byok/extraction";
import type { SignupExtractionBatchStore, TemplateTaskDeltaStore } from "@byok/db";

// The Anthropic SDK's raw error text for a rejected key ("401
// {"type":"error","error":{"type":"authentication_error",...}}") never
// contains the key itself, but it's still internal wire format, not
// something to hand a user — and it's genuinely a different situation
// from "extraction failed" (nothing to retry, the platform key needs
// fixing). Both 401 (bad/revoked key) and 403 (key valid but lacks
// access) read as "this key doesn't work" from the caller's side.
function isApiKeyRejection(err: unknown): boolean {
  return err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError;
}

export interface RunExtractionBatchDeps {
  costGate: CostGate;
  // Narrowed to just the methods used, not the concrete class — its pool
  // field is private, which would otherwise force every test to construct
  // a real one.
  batchStore: Pick<SignupExtractionBatchStore, "start" | "complete" | "fail">;
  /** Template-learning capture layer (docs/STATUS.md) — records what the
   *  customize pass added/removed/adjusted vs. the template's own
   *  proposal. Best-effort: a write failure here must never fail the
   *  batch itself, since the org chart is already the real product. */
  taskDeltaStore: Pick<TemplateTaskDeltaStore, "recordMany">;
  apiKey: string;
  /** Defaults to the real extractOrgChart — injectable so tests can
   *  exercise the gate/batchStore orchestration above without a
   *  live Anthropic call, the same reason OpenMultiAgentExecutor takes an
   *  orchestratorFactory instead of constructing its client inline. */
  extract?: typeof extractOrgChart;
}

export interface RunExtractionBatchInput {
  userId: string;
  idea: string;
  answers: InterviewAnswers;
}

export type RunExtractionBatchResult =
  | { status: "completed"; batchId: string; chart: OrgChart; costUsd: number }
  | { status: "queued" | "skipped"; batchId: string; reason: string }
  | { status: "failed"; batchId: string; error: string };

/**
 * The platform-key onboarding batch (ADR-003), gated by CostGate directly
 * rather than through Router.submitTask (ADR-014). submitTask's
 * approval-queue coupling exists for real agent ACTIONS that might do
 * something in the world a human should review before it happens —
 * extraction has no effect and produces a document (the org chart) the
 * user reviews directly in the UI, so routing it through submitTask would
 * queue every signup's org chart for "human approval," which the
 * mechanism was never meant for.
 *
 * #120: this used to also append to Router's shared TaskLedger, purely
 * for visibility — removed when that ledger became durable and
 * tenant-scoped (durable/ledgerStore.ts), since this function runs
 * BEFORE any tenant exists (ADR-015) and has no tenantId to give it.
 * Nothing lost: batchStore.start/complete/fail (below) already durably
 * tracks this exact batch's lifecycle in Postgres, and nothing in
 * production ever read the ledger's own entriesFor() for this
 * (or any) subAgentId — confirmed before removing, not assumed.
 */
export async function runExtractionBatch(
  deps: RunExtractionBatchDeps,
  input: RunExtractionBatchInput,
): Promise<RunExtractionBatchResult> {
  const batch = await deps.batchStore.start(input.userId, input.idea);
  const taskId = batch.id;
  const { verdict, reservation } = await deps.costGate.evaluateAndReserve({
    taskId,
    // There's no company/tenant yet at this pre-org stage (ADR-015) — the
    // signing-up user's own id is the natural per-signup ceiling scope
    // issue #47 asks for, so onboarding cost stays isolated per user
    // instead of pooling across every signup on the deployment.
    tenantId: input.userId,
    roleId: "onboarding",
    taskType: "extraction-batch",
    payload: input.idea,
    model: CUSTOMIZE_MODEL,
    outputClass: "short-structured",
    // Not batchable: there's no worker that later retries a queued
    // extraction batch, and the point is an immediate interview -> chart
    // experience — if it doesn't fit the ceiling right now, the honest
    // answer is to tell the user that plainly, not queue it silently.
    batchable: false,
  });

  if (verdict.kind === "QUEUE" || verdict.kind === "SKIP") {
    const status = verdict.kind === "QUEUE" ? "queued" : "skipped";
    // verdict.reason is deliberately internal/technical (ceiling level,
    // durable-store detail) — logged for operators, but never shown to the
    // user directly; the user-facing reason stays plain language regardless
    // of which ceiling tripped or why.
    await deps.batchStore.fail(input.userId, batch.id, `${verdict.kind}: ${verdict.reason}`);
    const userReason =
      verdict.kind === "QUEUE"
        ? "We're at today's AI usage limit for new companies — you're queued and this will finish automatically soon."
        : "We're at today's AI usage limit for new companies right now. Please try again in a few minutes.";
    return { status, batchId: batch.id, reason: userReason };
  }

  // CostGate.evaluateAndReserve only omits a reservation on QUEUE/SKIP
  // (packages/cost-gate/src/costGate.ts) — both already handled above, so
  // reaching here without one would mean that invariant broke, not a
  // normal case to route around silently.
  if (!reservation) {
    throw new Error(`CostGate returned a ${verdict.kind} verdict with no reservation — invariant violation.`);
  }

  try {
    // verdict.model carries a DOWNGRADE's rewritten model, if any — but
    // extractOrgChart's own internal calls each name their own model
    // (customize.ts, categoryValidator.ts, onboardingBatch.ts) and aren't
    // parameterized by this outer estimate; the outer reservation is a
    // ceiling check on the batch as a whole, not a per-call override.
    const extract = deps.extract ?? extractOrgChart;
    const chart = await extract(input.idea, input.answers, { apiKey: deps.apiKey });
    await deps.costGate.settle(reservation.id, chart.meta.costUsd);
    await deps.batchStore.complete(input.userId, batch.id, chart, chart.meta.costUsd);
    try {
      const deltas = customizationLogToDeltas(chart.customization, chart.tasks);
      await deps.taskDeltaStore.recordMany(input.userId, batch.id, chart.meta.templateSelection.primary, deltas, "generation");
    } catch (err) {
      // Capture is a side-channel for future template learning — never let
      // it fail a batch whose real product (the org chart) already saved.
      console.error(`Template task delta capture failed for batch ${batch.id}:`, err);
    }
    return { status: "completed", batchId: batch.id, chart, costUsd: chart.meta.costUsd };
  } catch (err) {
    await deps.costGate.release(reservation.id);
    const message = isApiKeyRejection(err)
      ? "The AI provider rejected the platform's API key. Extraction can't run until this is fixed — try again later."
      : err instanceof Error
        ? err.message
        : "extraction failed";
    await deps.batchStore.fail(input.userId, batch.id, message);
    return { status: "failed", batchId: batch.id, error: message };
  }
}
