import Anthropic from "@anthropic-ai/sdk";
import type { InterviewAnswers, OrgChart } from "@byok/contracts";
import type { CostGate } from "@byok/cost-gate";
import { CUSTOMIZE_MODEL, extractOrgChart } from "@byok/extraction";
import type { TaskLedger } from "@byok/router";
import type { SignupExtractionBatchStore } from "@byok/db";

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
  ledger: TaskLedger;
  // Narrowed to just the methods used, not the concrete class — its pool
  // field is private, which would otherwise force every test to construct
  // a real one (matches TaskLedger's own interface/InMemoryTaskLedger split).
  batchStore: Pick<SignupExtractionBatchStore, "start" | "complete" | "fail">;
  apiKey: string;
  /** Defaults to the real extractOrgChart — injectable so tests can
   *  exercise the gate/ledger/batchStore orchestration above without a
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
 * mechanism was never meant for. The ledger append calls below give this
 * the same visibility a submitTask-routed task would have gotten, without
 * that mismatch.
 */
export async function runExtractionBatch(
  deps: RunExtractionBatchDeps,
  input: RunExtractionBatchInput,
): Promise<RunExtractionBatchResult> {
  const batch = await deps.batchStore.start(input.userId, input.idea);
  const taskId = batch.id;
  const now = () => new Date().toISOString();

  deps.ledger.append({ taskId, subAgentId: "extraction-batch", status: "pending", at: now() });

  const { verdict, reservation } = deps.costGate.evaluateAndReserve({
    taskId,
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
    deps.ledger.append({ taskId, subAgentId: "extraction-batch", status, at: now(), note: verdict.reason });
    await deps.batchStore.fail(input.userId, batch.id, `${verdict.kind}: ${verdict.reason}`);
    return { status, batchId: batch.id, reason: verdict.reason };
  }

  // CostGate.evaluateAndReserve only omits a reservation on QUEUE/SKIP
  // (packages/cost-gate/src/costGate.ts) — both already handled above, so
  // reaching here without one would mean that invariant broke, not a
  // normal case to route around silently.
  if (!reservation) {
    throw new Error(`CostGate returned a ${verdict.kind} verdict with no reservation — invariant violation.`);
  }

  deps.ledger.append({ taskId, subAgentId: "extraction-batch", status: "in_progress", at: now() });

  try {
    // verdict.model carries a DOWNGRADE's rewritten model, if any — but
    // extractOrgChart's own internal calls each name their own model
    // (customize.ts, categoryValidator.ts, onboardingBatch.ts) and aren't
    // parameterized by this outer estimate; the outer reservation is a
    // ceiling check on the batch as a whole, not a per-call override.
    const extract = deps.extract ?? extractOrgChart;
    const chart = await extract(input.idea, input.answers, { apiKey: deps.apiKey });
    deps.costGate.settle(reservation.id, chart.meta.costUsd);
    await deps.batchStore.complete(input.userId, batch.id, chart, chart.meta.costUsd);
    deps.ledger.append({ taskId, subAgentId: "extraction-batch", status: "completed", at: now() });
    return { status: "completed", batchId: batch.id, chart, costUsd: chart.meta.costUsd };
  } catch (err) {
    deps.costGate.release(reservation.id);
    const message = isApiKeyRejection(err)
      ? "The AI provider rejected the platform's API key. Extraction can't run until this is fixed — try again later."
      : err instanceof Error
        ? err.message
        : "extraction failed";
    await deps.batchStore.fail(input.userId, batch.id, message);
    deps.ledger.append({ taskId, subAgentId: "extraction-batch", status: "failed", at: now(), note: message });
    return { status: "failed", batchId: batch.id, error: message };
  }
}
