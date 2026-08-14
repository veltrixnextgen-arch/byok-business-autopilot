import type { Cadence, Frequency, TriggerType } from "./types.js";

// R3 prerequisite: template-origin tasks carry cadence/batchable/
// triggerType straight through from their TemplateTask (R1) — see
// pipeline.ts's templateTaskToTask, a plain spread. Customize-added tasks
// have no template to inherit from (they're the customize LLM's own
// invention), so this derives the same three fields DETERMINISTICALLY —
// never a second LLM call, never guessed at schedule time. Calibrated
// against the exact heuristics R1's authoring pass used across all seven
// templates (docs/DECISIONS.md's R1 entry / TRACKING.md), matched on
// agentType keywords rather than exact template agentType strings, since a
// customize-added task's agentType is idea-specific and won't match a
// template's literal id.
export interface ScheduleMetadata {
  cadence: Cadence | null;
  batchable: boolean;
  triggerType: TriggerType;
}

const KEYWORD_RULES: { pattern: RegExp; metadata: ScheduleMetadata }[] = [
  // Inbound-message triage/escalation — always event-driven (R1's one
  // explicit plan-calibrated example: "support triage is event-driven").
  { pattern: /triage|escalation/i, metadata: { cadence: null, batchable: false, triggerType: "event" } },
  // Expense categorization — plan's other explicit example: "nightly-batched".
  { pattern: /expense/i, metadata: { cadence: "nightly", batchable: true, triggerType: "cadence" } },
  // Cash-flow forecast — plan's explicit example: "weekly" (not the
  // frequency field's usual "monthly").
  { pattern: /cashflow|cash-flow|forecast/i, metadata: { cadence: "weekly", batchable: false, triggerType: "cadence" } },
  // Tax-deadline tracking — plan's explicit example: "monthly".
  { pattern: /tax/i, metadata: { cadence: "monthly", batchable: false, triggerType: "cadence" } },
  // Inventory/reorder-point watching — a threshold check (plan §3c),
  // checked daily.
  { pattern: /inventory|reorder/i, metadata: { cadence: "daily", batchable: true, triggerType: "threshold" } },
];

const FREQUENCY_TO_CADENCE: Record<Exclude<Frequency, "adhoc">, Cadence> = {
  daily: "daily",
  weekly: "weekly",
  monthly: "monthly",
};

/** `frequency` and `agentType` are always present on a customize-added
 *  task (CustomizeAddition) — this never has to guess at missing input. */
export function deriveScheduleMetadata(frequency: Frequency, agentType: string): ScheduleMetadata {
  for (const rule of KEYWORD_RULES) {
    if (rule.pattern.test(agentType)) return rule.metadata;
  }
  // "adhoc" has no fixed-interval cadence by definition — same mapping R1
  // used for every adhoc-frequency template task (job posts, applicant
  // review): no standing schedule, fires on a signal instead.
  if (frequency === "adhoc") return { cadence: null, batchable: false, triggerType: "event" };
  return { cadence: FREQUENCY_TO_CADENCE[frequency], batchable: false, triggerType: "cadence" };
}
