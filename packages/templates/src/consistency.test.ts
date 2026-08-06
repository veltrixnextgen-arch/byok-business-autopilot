import { test } from "node:test";
import assert from "node:assert/strict";
import { allTemplates } from "./index.js";

// Found by a manual cross-template audit (2026-08-06): the same task id
// (ops.vendor.comms) carried tier T2 in ecommerce.ts and T1 in local.ts —
// same job, same autonomy default, no stated reason for the split. Tier and
// autonomy drive real behavior (which Brain a sub-agent runs on, whether an
// action can earn autonomy) — a task type silently getting cheaper/more or
// less autonomous depending on which business template happened to define
// it is exactly the kind of drift that shouldn't need a human to notice by
// eye. This guards it going forward: any task id appearing in 2+ templates
// must carry the same tier, autonomy default, and
// requiresProfessionalVerification flag everywhere it appears.
//
// Deliberately NOT checked here: handsTool/handsScope. Those legitimately
// vary by template (local.ts's own-payments processor is Square, not
// Stripe; a template with no "delivery" team has nothing to disambiguate
// handsScope against) — see docs/design/tool-registry.md §3's notes on
// which observed variances are real bugs vs. defensible per-template
// choices. Flagging those here would make this test fail on intentional
// differences, not just accidental ones.
test("a shared task id carries the same tier, autonomy, and compliance flag across every template that defines it", () => {
  const byId = new Map<string, Array<{ template: string; tier: string; autonomy: string; requiresProfessionalVerification: boolean }>>();

  for (const [templateId, template] of Object.entries(allTemplates)) {
    for (const task of template.tasks) {
      const entry = {
        template: templateId,
        tier: task.tier,
        autonomy: task.autonomy,
        requiresProfessionalVerification: task.requiresProfessionalVerification ?? false,
      };
      const existing = byId.get(task.id);
      if (existing) existing.push(entry);
      else byId.set(task.id, [entry]);
    }
  }

  const divergences: string[] = [];
  for (const [id, entries] of byId) {
    if (entries.length < 2) continue;
    const tiers = new Set(entries.map((e) => e.tier));
    const autonomies = new Set(entries.map((e) => e.autonomy));
    const compliance = new Set(entries.map((e) => e.requiresProfessionalVerification));
    if (tiers.size > 1 || autonomies.size > 1 || compliance.size > 1) {
      const detail = entries.map((e) => `${e.template}: tier=${e.tier} autonomy=${e.autonomy} requiresProfessionalVerification=${e.requiresProfessionalVerification}`).join("; ");
      divergences.push(`"${id}" — ${detail}`);
    }
  }

  assert.deepEqual(divergences, [], `Tier/autonomy/compliance drift found for shared task ids:\n${divergences.join("\n")}`);
});
