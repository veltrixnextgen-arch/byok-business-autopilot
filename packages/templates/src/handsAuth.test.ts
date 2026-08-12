import { test } from "node:test";
import assert from "node:assert/strict";
import { allTemplates } from "./index.js";
import { authMethodForTool, HANDS_AUTH_METHOD } from "./handsAuth.js";

// The whole point of handsAuth.ts (issue #22 follow-up, PR "stop offering
// what we can't deliver"): apps/web's connect UI must never assume a
// service takes a pasted key just because nobody registered it here. A
// template that introduces a new handsTool string without a matching
// entry would otherwise fall through authMethodForTool's "oauth" default
// silently — safe (never shows a broken key field), but silent drift is
// still drift. Fail loudly instead, so the classification is a deliberate
// research-backed decision (tool-registry.md §2b) every time.
test("every handsTool value declared across every template has a registered auth method", () => {
  const missing = new Set<string>();
  for (const template of Object.values(allTemplates)) {
    for (const task of template.tasks) {
      if (task.handsTool && !(task.handsTool in HANDS_AUTH_METHOD)) {
        missing.add(task.handsTool);
      }
    }
  }
  assert.deepEqual(
    [...missing],
    [],
    `handsTool value(s) with no HANDS_AUTH_METHOD entry — classify against docs/design/tool-registry.md §2b before adding: ${[...missing].join(", ")}`,
  );
});

test("authMethodForTool falls back to the honest 'oauth' (no key field) state for anything unregistered", () => {
  assert.equal(authMethodForTool("some-future-tool-nobody-classified-yet"), "oauth");
});

test("authMethodForTool matches the registered method for every known tool", () => {
  for (const [tool, entry] of Object.entries(HANDS_AUTH_METHOD)) {
    assert.equal(authMethodForTool(tool), entry.method, `mismatch for "${tool}"`);
  }
});
