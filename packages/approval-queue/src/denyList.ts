// Hard deny-list, per userflow-v2.md Stage 5 item 14: "Money-moving,
// external sending, and deploys never earn autonomy." Checked against a
// ProposedAction's stakesTags. Two of these tag strings are the exact
// vocabulary apps/router/src/tagging.ts already derives from extraction-
// engine hints (never-autonomous, requires-professional-verification) —
// intentional, so a task the extraction engine already marked
// never-autonomous or compliance-flagged is automatically deny-listed here
// too, no separate configuration needed.
export const DENY_LIST_TAGS: ReadonlySet<string> = new Set([
  "money-movement",
  "external-send-high-stakes",
  "deploy",
  "requires-professional-verification",
  "never-autonomous",
]);

export function isDeniedFromAutonomy(stakesTags: readonly string[]): boolean {
  return stakesTags.some((tag) => DENY_LIST_TAGS.has(tag));
}
