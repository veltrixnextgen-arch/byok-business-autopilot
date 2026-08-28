import Anthropic from "@anthropic-ai/sdk";
import type { CostGate } from "@byok/cost-gate";
import { fetchWebsiteText, summarizeWebsite, WEBSITE_SUMMARY_MODEL, WebsiteFetchFailedError, WebsiteFetchTimeoutError, UnsafeWebsiteUrlError } from "@byok/extraction";

const FETCH_TIMEOUT_MS = 10_000; // matches packages/vault's own DEFAULT_REFRESH_TIMEOUT_MS

export interface RunWebsiteSummaryDeps {
  costGate: CostGate;
  apiKey: string;
  fetchText?: typeof fetchWebsiteText;
  summarize?: typeof summarizeWebsite;
}

export type RunWebsiteSummaryResult =
  | { status: "completed"; summary: string }
  | { status: "insufficient-content" }
  | { status: "unsafe-url"; error: string }
  | { status: "unreachable"; error: string }
  | { status: "queued" | "skipped"; reason: string }
  | { status: "failed"; error: string };

/**
 * ADR-058: website-as-input. Gated by its OWN CostGate reservation,
 * separate from the extraction batch's (runExtractionBatch.ts) — this
 * runs BEFORE the batch even starts, and a fetch that fails (dead link,
 * timeout, unsafe URL) should never consume budget the batch then needs.
 * roleId "onboarding" (same pre-org, per-user scope as the batch — ADR-015
 * has no tenant yet at this stage), a distinct taskType so operators can
 * tell the two apart in the ledger.
 *
 * The fetch itself is NOT gated by CostGate — it costs nothing but a
 * bounded network round-trip. Only the summarization LLM call reserves
 * budget, and only once real page text exists to estimate a prompt size
 * from (payload below is the fetched text, not the URL — an accurate
 * estimate needs the thing actually being summarized).
 */
export async function runWebsiteSummary(deps: RunWebsiteSummaryDeps, userId: string, url: string): Promise<RunWebsiteSummaryResult> {
  const fetchText = deps.fetchText ?? fetchWebsiteText;
  const summarize = deps.summarize ?? summarizeWebsite;

  let pageText: string;
  try {
    const result = await fetchText(url, { timeoutMs: FETCH_TIMEOUT_MS });
    pageText = result.text;
  } catch (err) {
    if (err instanceof UnsafeWebsiteUrlError) return { status: "unsafe-url", error: err.message };
    if (err instanceof WebsiteFetchTimeoutError || err instanceof WebsiteFetchFailedError) return { status: "unreachable", error: err.message };
    throw err;
  }

  if (pageText.trim().length < 100) {
    // Too thin to bother spending a model call on — a JS-rendered shell
    // with no server-rendered content typically lands here.
    return { status: "insufficient-content" };
  }

  const taskId = `website-summary:${userId}:${Date.now()}`;
  const { verdict, reservation } = await deps.costGate.evaluateAndReserve({
    taskId,
    tenantId: userId,
    roleId: "onboarding",
    taskType: "website-summary",
    payload: pageText,
    model: WEBSITE_SUMMARY_MODEL,
    outputClass: "short-structured",
    batchable: false,
  });

  if (verdict.kind === "QUEUE" || verdict.kind === "SKIP") {
    const reason =
      verdict.kind === "QUEUE"
        ? "We're at today's AI usage limit for new companies — try describing your business instead."
        : "We're at today's AI usage limit for new companies right now — try describing your business instead.";
    return { status: verdict.kind === "QUEUE" ? "queued" : "skipped", reason };
  }
  if (!reservation) {
    throw new Error(`CostGate returned a ${verdict.kind} verdict with no reservation — invariant violation.`);
  }

  try {
    const result = await summarize(pageText, deps.apiKey, reservation.amountUsd);
    await deps.costGate.settle(reservation.id, result.costUsd);
    if (!result.sufficientContent || !result.summary.trim()) {
      return { status: "insufficient-content" };
    }
    return { status: "completed", summary: result.summary.trim() };
  } catch (err) {
    await deps.costGate.release(reservation.id);
    const isApiKeyRejection = err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError;
    const message = isApiKeyRejection
      ? "The AI provider rejected the platform's API key — try describing your business instead."
      : err instanceof Error
        ? err.message
        : "website summary failed";
    return { status: "failed", error: message };
  }
}
