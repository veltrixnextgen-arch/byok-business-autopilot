import { test } from "node:test";
import assert from "node:assert/strict";
import { allTemplates } from "./index.js";
import { authMethodForTool, HANDS_AUTH_METHOD, oauthServiceForTool } from "./handsAuth.js";

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

test("authMethodForTool falls back to the honest 'oauth-pending' (no key field, no live OAuth button) state for anything unregistered", () => {
  assert.equal(authMethodForTool("some-future-tool-nobody-classified-yet"), "oauth-pending");
});

test("authMethodForTool matches the registered method for every known tool", () => {
  for (const [tool, entry] of Object.entries(HANDS_AUTH_METHOD)) {
    assert.equal(authMethodForTool(tool), entry.method, `mismatch for "${tool}"`);
  }
});

// PR 2B: every "oauth-live" entry must actually name which apps/api
// service its connect button hits — an entry that forgot oauthService
// would otherwise render a live-looking "Connect" button that 404s on
// click, exactly the "stop offering what we can't deliver" failure this
// whole file exists to prevent, just one level deeper.
test("every 'oauth-live' entry declares a non-empty oauthService", () => {
  const missing = Object.entries(HANDS_AUTH_METHOD)
    .filter(([, entry]) => entry.method === "oauth-live" && !entry.oauthService?.trim())
    .map(([tool]) => tool);
  assert.deepEqual(missing, [], `"oauth-live" tool(s) with no oauthService: ${missing.join(", ")}`);
});

test("oauthServiceForTool returns the service id only for 'oauth-live' tools, null for everything else", () => {
  assert.equal(oauthServiceForTool("Calendar"), "google-calendar");
  assert.equal(oauthServiceForTool("Stripe"), null); // "key"
  assert.equal(oauthServiceForTool("Instagram/Meta"), null); // "oauth-pending"
  assert.equal(oauthServiceForTool("some-unregistered-tool"), null);
});
