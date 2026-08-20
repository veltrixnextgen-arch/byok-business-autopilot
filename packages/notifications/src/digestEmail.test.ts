import assert from "node:assert/strict";
import { test } from "node:test";
import { buildDigestEmail } from "./digestEmail.js";

test("lists each agent's task count and spend, honest when there's real activity", () => {
  const { subject, text } = buildDigestEmail({
    date: "2026-08-20",
    agentActivity: [
      { agentName: "Sam (Expenses)", taskCount: 3, spentUsd: 1.5 },
      { agentName: "Jordan (CEO)", taskCount: 1, spentUsd: 0.05 },
    ],
    pendingApprovalCount: 2,
    spentUsd: 12.34,
    ceilingUsd: 50,
    dashboardUrl: "https://example.com",
  });
  assert.equal(subject, "Your daily summary — 2026-08-20");
  assert.match(text, /Sam \(Expenses\): 3 tasks, \$1\.50/);
  assert.match(text, /Jordan \(CEO\): 1 task, \$0\.05/);
  assert.match(text, /2 items waiting on your approval/);
  assert.match(text, /\$12\.34 of your \$50\.00 monthly ceiling/);
  assert.match(text, /https:\/\/example\.com\/digest/);
});

test("uses singular 'task' for exactly one task, and singular 'item' for exactly one pending approval", () => {
  const { text } = buildDigestEmail({
    date: "2026-08-20",
    agentActivity: [{ agentName: "Sam", taskCount: 1, spentUsd: 0.1 }],
    pendingApprovalCount: 1,
    spentUsd: 0.1,
    ceilingUsd: 50,
    dashboardUrl: "https://example.com",
  });
  assert.match(text, /Sam: 1 task, /);
  assert.doesNotMatch(text, /1 tasks,/);
  assert.match(text, /1 item waiting on your approval/);
});

test("says 'No agent activity today' rather than an empty or fabricated list", () => {
  const { text } = buildDigestEmail({
    date: "2026-08-20",
    agentActivity: [],
    pendingApprovalCount: 0,
    spentUsd: 0,
    ceilingUsd: 50,
    dashboardUrl: "https://example.com",
  });
  assert.match(text, /No agent activity today\./);
  assert.match(text, /Nothing waiting on your approval\./);
});
