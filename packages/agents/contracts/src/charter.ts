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

// Per docs/product/userflow-v2.md Stage 4, Screen 10.
export interface Charter {
  sharpenedIdea: string;
  mvpDefinition: string;
  roleTasks: { roleTitle: string; tasks: string[] }[];
  monthOneGoals: string[];
  budgetCeilingPlaceholder: string;
}

export interface OnboardingBatch {
  simulatedDay: SimulatedDayCard[];
  charterDraft: Charter;
}
