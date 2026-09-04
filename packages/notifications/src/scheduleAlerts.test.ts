import assert from "node:assert/strict";
import { test } from "node:test";
import { buildSchedulePausedEmail, buildScheduleResumedEmail, buildSubscriptionRequiredEmail } from "./scheduleAlerts.js";

test("schedule-paused email names the ceiling-exhausted reason, remaining task count, and both dollar figures", () => {
  const { subject, text } = buildSchedulePausedEmail({
    reason: "ceiling-exhausted",
    remainingTaskCount: 3,
    ceilingUsd: 50,
    spentUsd: 51.2,
    dashboardUrl: "https://runwisely-autopilot.vercel.app/dashboard",
  });
  assert.equal(subject, "Your automation has paused");
  assert.match(text, /monthly spend ceiling was reached/);
  assert.match(text, /3 tasks waiting/);
  assert.match(text, /\$51\.20 of your \$50\.00 monthly ceiling/);
  assert.match(text, /https:\/\/runwisely-autopilot\.vercel\.app\/dashboard/);
});

test("uses singular 'task' for exactly one remaining task", () => {
  const { text } = buildSchedulePausedEmail({
    reason: "ceiling-exhausted",
    remainingTaskCount: 1,
    ceilingUsd: 50,
    spentUsd: 50.5,
    dashboardUrl: "https://example.com",
  });
  assert.match(text, /1 task waiting/);
  assert.doesNotMatch(text, /1 tasks waiting/);
});

test("names the provider-billing-failure reason distinctly from ceiling-exhausted", () => {
  const { text } = buildSchedulePausedEmail({
    reason: "provider-billing-failure",
    remainingTaskCount: 2,
    ceilingUsd: 50,
    spentUsd: 10,
    dashboardUrl: "https://example.com",
  });
  assert.match(text, /billing issue with your AI provider/);
  assert.doesNotMatch(text, /ceiling was reached/);
});

test("falls back to 'Some work' when the remaining task count couldn't be read", () => {
  const { text } = buildSchedulePausedEmail({
    reason: "ceiling-exhausted",
    remainingTaskCount: null,
    ceilingUsd: 50,
    spentUsd: 50,
    dashboardUrl: "https://example.com",
  });
  assert.match(text, /Some work waiting/);
});

// One company per user (2026-09-03): must never mention a ceiling or
// dollar figure — this pause has nothing to do with spend, and reusing
// the ceiling-exhausted copy here is exactly the misleading-signal bug
// this dedicated email exists to avoid.
test("subscription-required email names the real reason and never mentions a ceiling or dollar figure", () => {
  const { subject, text } = buildSubscriptionRequiredEmail({ dashboardUrl: "https://example.com/dashboard" });
  assert.match(subject, /subscription/i);
  assert.match(text, /no active subscription/);
  assert.match(text, /Resubscribe/);
  assert.match(text, /https:\/\/example\.com\/dashboard/);
  assert.doesNotMatch(text, /ceiling/i);
  assert.doesNotMatch(text, /\$\d/);
});

test("schedule-resumed email is short and links back to the dashboard", () => {
  const { subject, text } = buildScheduleResumedEmail({ dashboardUrl: "https://example.com/dashboard" });
  assert.equal(subject, "Your automation has resumed");
  assert.match(text, /running again/);
  assert.match(text, /https:\/\/example\.com\/dashboard/);
});
