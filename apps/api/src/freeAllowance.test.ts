import assert from "node:assert/strict";
import { test } from "node:test";
import { FREE_TIER_ROLLOUT_DATE, FREE_TRIAL_DAYS, withinFreeAllowance } from "./freeAllowance.js";

test("a tenant created before rollout is grandfathered permanently, even long past any trial window", () => {
  const beforeRollout = new Date(FREE_TIER_ROLLOUT_DATE.getTime() - 365 * 24 * 60 * 60 * 1000);
  assert.equal(withinFreeAllowance(beforeRollout), true);
});

test("a brand new tenant is within its trial the moment it's created", () => {
  assert.equal(withinFreeAllowance(new Date()), true);
});

// A fixed reference point safely after rollout, not real Date.now() —
// on any real date within FREE_TRIAL_DAYS of FREE_TIER_ROLLOUT_DATE
// itself (true as of this writing), no timestamp can be BOTH "created
// after rollout" and "more than a trial-length before the real now" at
// once, since that much real time genuinely hasn't passed yet.
const LONG_AFTER_ROLLOUT = new Date(FREE_TIER_ROLLOUT_DATE.getTime() + 100 * 24 * 60 * 60 * 1000);

test("a new tenant is still within allowance just under the trial boundary", () => {
  const justUnder = new Date(LONG_AFTER_ROLLOUT.getTime() - (FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000 - 1000));
  assert.equal(withinFreeAllowance(justUnder, LONG_AFTER_ROLLOUT), true);
});

test("a new tenant falls out of allowance once the trial has genuinely elapsed", () => {
  const justOver = new Date(LONG_AFTER_ROLLOUT.getTime() - (FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000 + 1000));
  assert.equal(withinFreeAllowance(justOver, LONG_AFTER_ROLLOUT), false);
});

test("a missing tenant row (createdAt null) is never within the allowance -- fails closed, not open", () => {
  assert.equal(withinFreeAllowance(null), false);
});
