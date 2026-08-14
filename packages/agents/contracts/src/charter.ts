import type { PromptCascade } from "./cascade.js";

// master-plan-v2.md §4 (Phase A): "Task Extraction Engine ... also emits the
// simulated-day script and Charter draft from the same batch." Per
// docs/product/userflow-v2.md Stage 2 Screen 6: a mock morning digest with
// fake approval cards, illustrative only, zero real execution.
export interface SimulatedDayCard {
  agentId: string;
  /** Always overwritten to match the Agent's canonical `name` after the
   *  generation call returns (see onboardingBatch.ts) — never trust an
   *  LLM to independently reinvent a name that must stay identical to the
   *  one on the org chart. userflow-v2.md: "Names flow through everything
   *  downstream: digest, approval queue, dashboard" — that only holds if
   *  this is enforced, not merely prompted for. */
  agentName: string;
  roleTitle: string;
  summary: string;
}

// Per docs/product/userflow-v2.md Stage 4, Screen 10, and R2 (see ADR-024):
// role mandates replace the original bare task list — a one-line authority/
// scope statement per role, not just what it does but what it's trusted to
// decide — and budgetCeilingUsd is a real, enforceable number rather than
// the placeholder string R2's predecessor shipped (that placeholder existed
// only because the interview never collected a figure; R2 resolves it
// deterministically instead of asking the model to invent one — see
// onboardingBatch.ts's buildPrompt/generateOnboardingBatch).
export interface RoleMandate {
  roleTitle: string;
  /** One or two sentences: what this role is trusted to decide and act on
   *  without asking, and where its authority stops. Distinct from `tasks`
   *  (what it does) — a mandate is the boundary of its judgment. */
  mandate: string;
  tasks: string[];
}

export interface Charter {
  sharpenedIdea: string;
  mvpDefinition: string;
  roleMandates: RoleMandate[];
  monthOneGoals: string[];
  /** A real number, not a placeholder string — deterministically resolved
   *  (never LLM-guessed) to the same platform default the cost gate itself
   *  enforces (apps/api/src/routes/ceiling.ts's DEFAULT_MONTHLY_CEILING_USD)
   *  so the Charter's stated ceiling is never a second, disconnected figure.
   *  Editable later via the same ceiling-override path (issue #15). */
  budgetCeilingUsd: number;
}

export interface OnboardingBatch {
  simulatedDay: SimulatedDayCard[];
  charterDraft: Charter;
}

// ---- R2: the versioned, tenant-owned Charter (ADR-024) --------------------
//
// `Charter` above is the pure CONTENT shape — reused both as the pre-
// acceptance draft embedded in OnboardingBatch (LLM-authored, no tenant yet)
// and as the `content` of a CompanyCharter row below (tenant-owned, real
// versions). Keeping content and the versioned wrapper as separate types
// means the draft-generation code (onboardingBatch.ts) never has to know
// about tenancy/versioning at all.

export type CharterStatus = "draft" | "active" | "superseded";

/** A durable, tenant-scoped Charter version (packages/db's company_charters
 *  table). Created at Charter ACCEPTANCE — the "hand the Charter to [CEO
 *  name]" ceremony (master-plan-v2.md Stage 4 #11) — not at draft time;
 *  before acceptance the draft lives only inside OnboardingBatch.charterDraft
 *  (ADR-015: no tenant exists yet to own a versioned record). `cascade` is
 *  null until the first installation and is regenerated (never a new
 *  version) on agent rename or autonomy change — only a content edit that
 *  produces a NEW accepted version bumps `version`. */
export interface CompanyCharter {
  id: string;
  tenantId: string;
  version: number;
  status: CharterStatus;
  content: Charter;
  cascade: PromptCascade | null;
  createdAt: string;
  installedAt: string | null;
}
