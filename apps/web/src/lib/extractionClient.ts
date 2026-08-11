import type { InterviewAnswers, InterviewQuestion, OrgChart, Task } from "@byok/contracts";
import { apiClient } from "./apiClient";

// The idea text and in-progress interview answers need to survive the
// idea-box -> signup -> interview navigation chain (a real page-to-page
// flow, not one component's state) without a state-management library
// (Phase B build rules) — sessionStorage is the platform's own answer to
// exactly this, scoped to one tab's lifetime. The extraction BATCH itself
// is what's required to survive a tab close (ADR-014/015's server-side
// persistence, fetched via getLatestBatch below) — the idea/in-progress
// answers are a much smaller "don't lose my typing on accidental back
// button" concern, not the resumability requirement.
const IDEA_KEY = "byok:idea";

export function saveIdea(idea: string): void {
  sessionStorage.setItem(IDEA_KEY, idea);
}

// `typeof window` guard: this is called from route `beforeLoad` hooks
// (dashboard.tsx, onboarding.tsx), which TanStack Start runs during SSR
// for a direct/reloaded page load, not just client-side navigations —
// `sessionStorage` doesn't exist there, and an unguarded read would crash
// the whole SSR render instead of just falling through to "no pending idea".
export function loadIdea(): string | null {
  if (typeof window === "undefined") return null;
  return sessionStorage.getItem(IDEA_KEY);
}

// Called once the interview's extraction actually completes (not on
// every terminal outcome — "failed"/"queued" leave the user retrying the
// same interview, so the idea is still live). Without this, a user who
// finishes onboarding and later revisits /dashboard in the same tab would
// keep getting bounced back into the interview forever, since the idea
// they already used would still read as "pending".
export function clearIdea(): void {
  if (typeof window === "undefined") return;
  sessionStorage.removeItem(IDEA_KEY);
}

export interface QuestionsResponse {
  questions: InterviewQuestion[];
  templateHint: string | null;
  guess: Partial<InterviewAnswers>;
}

/** Carries the HTTP status so callers can distinguish "session expired"
 *  (401) from a generic network/5xx failure without parsing message text. */
export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

export async function fetchQuestions(idea: string, answers?: Partial<InterviewAnswers>): Promise<QuestionsResponse> {
  const res = await apiClient.extraction.questions.$post({ json: { idea, answers } });
  if (!res.ok) throw new ApiError(res.status, `Could not load interview questions (${res.status}).`);
  return res.json();
}

export type StartBatchResult =
  | { status: "completed"; batchId: string; chart: OrgChart; costUsd: number }
  | { status: "queued" | "skipped"; batchId: string; reason: string }
  | { status: "failed"; batchId: string; error: string };

export async function startBatch(idea: string, answers: InterviewAnswers): Promise<StartBatchResult> {
  const res = await apiClient.extraction.batches.$post({ json: { idea, answers } });
  if (!res.ok) throw new Error(`Could not start extraction (${res.status}).`);
  const { result } = await res.json();
  return result as StartBatchResult;
}

export interface LatestBatch {
  id: string;
  idea: string;
  status: "running" | "completed" | "failed";
  orgChart: OrgChart | null;
  costUsd: number | null;
  error: string | null;
}

export async function getLatestBatch(): Promise<LatestBatch | null> {
  const res = await apiClient.extraction.batches.latest.$get();
  if (!res.ok) throw new Error(`Could not load your extraction batch (${res.status}).`);
  const { batch } = await res.json();
  return batch as LatestBatch | null;
}

// Issue #38: triggers the org-chart -> tenant handoff (ADR-015's deferred
// gap) — called once, right after org creation succeeds. Idempotent
// server-side, so a caller never needs to guard against calling this
// twice. Requires an active organization (mounted under tenantMiddleware),
// unlike everything else in this file.
export async function claimOrgChart(): Promise<LatestBatch | null> {
  const res = await apiClient.me["claim-org-chart"].$post();
  if (!res.ok) throw new Error(`Could not finish setting up your organization (${res.status}).`);
  const { batch } = await res.json();
  return batch as LatestBatch | null;
}

// The post-claim read path — once an organization exists, the org chart
// lives here, not at getLatestBatch's user-scoped endpoint (which can no
// longer see a claimed row once tenant_id is set).
export async function getOrgChartForTenant(): Promise<LatestBatch | null> {
  const res = await apiClient.me["org-chart"].$get();
  if (!res.ok) throw new Error(`Could not load your organization's chart (${res.status}).`);
  const { batch } = await res.json();
  return batch as LatestBatch | null;
}

export async function reassemble(batchId: string, tasks: Task[]): Promise<OrgChart> {
  const res = await apiClient.extraction.batches[":id"].reassemble.$post({
    param: { id: batchId },
    json: { tasks },
  });
  if (!res.ok) throw new Error(`Could not update your org chart (${res.status}).`);
  const { chart } = await res.json();
  return chart as OrgChart;
}

export async function renameAgent(batchId: string, agentId: string, name: string): Promise<OrgChart> {
  const res = await apiClient.extraction.batches[":id"]["rename-agent"].$post({
    param: { id: batchId },
    json: { agentId, name },
  });
  if (!res.ok) throw new Error(`Could not rename that agent (${res.status}).`);
  const { chart } = await res.json();
  return chart as OrgChart;
}

export type FunnelScreen = "signup" | "interview" | "tasks" | "org_chart";

/** MVP-0 tester gate (Phase B Step 6C) — fire-and-forget on purpose:
 *  losing a funnel event is a metrics gap, not something worth blocking
 *  or degrading the actual signup flow over. Swallows its own errors. */
export function recordFunnelEvent(screen: FunnelScreen): void {
  apiClient.metrics["funnel-event"].$post({ json: { screen } }).catch(() => {});
}

export async function submitFeedback(taughtSomething: boolean, freeText?: string): Promise<void> {
  const res = await apiClient.metrics.feedback.$post({ json: { taughtSomething, freeText } });
  if (!res.ok) throw new Error(`Could not submit feedback (${res.status}).`);
}
