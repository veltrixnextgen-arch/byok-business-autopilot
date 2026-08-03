// Rule-based tagging. Hints are optional and typically come from an
// extraction-engine Task (stakes/autonomy/frequency/compliance
// metadata) — but the router works without them too, since not every task
// originates from the extraction engine.
export interface TaggingHints {
  stakes?: "low" | "medium" | "high";
  autonomy?: "locked" | "earnable" | "eligible-early";
  frequency?: "daily" | "weekly" | "monthly" | "adhoc";
  requiresProfessionalVerification?: boolean;
}

export function deriveTags(hints: TaggingHints = {}, explicitTags: string[] = []): string[] {
  const tags = new Set(explicitTags);

  if (hints.stakes === "high") tags.add("high-stakes");
  if (hints.autonomy === "locked") tags.add("never-autonomous");
  if (hints.autonomy === "eligible-early") tags.add("autonomy-eligible");
  if (hints.frequency === "daily") tags.add("high-volume");
  if (hints.requiresProfessionalVerification) tags.add("requires-professional-verification");

  return [...tags].sort();
}
