// One company per user (2026-09-04): the north star's own paywall
// position is "the paywall sits at ACTIVATION, not at understanding" --
// a user sees their org chart/Charter/blueprint free, and pays to
// operate. CostGate's strict "active AND has a subscription" check
// would have blocked every tenant with no subscription, including every
// real tenant on this account today (verified directly against
// production: A/Acme/Fitbite all have stripe_subscription_id = NULL) --
// shipping that unmodified would have stopped real dogfooding the hour
// it deployed.
//
// The free allowance chosen here needs zero new schema: tenants.created_at
// already exists.
//   - A brand new tenant (created on or after ROLLOUT_DATE) gets
//     TRIAL_DAYS from its own creation before a real subscription is
//     required.
//   - A tenant that already existed before this rule shipped is
//     grandfathered permanently -- real accounts a person is already
//     running must keep working, not be retroactively cut off by a rule
//     that didn't exist when they signed up. If Acme/Fitbite/A should
//     ever actually be required to subscribe, that's a deliberate later
//     decision (lowering/removing the grandfather), not a side effect of
//     this fix.
//
// Shared by both CostGate's tenantEligibility resolver (durableTrustCore.ts)
// and the scheduler's own hasSpendAllowance check (server.ts) -- they
// must agree on this exactly, not each carry their own copy that can
// drift apart.
export const FREE_TRIAL_DAYS = 14;
export const FREE_TIER_ROLLOUT_DATE = new Date("2026-09-04T00:00:00Z");

const FREE_TRIAL_MS = FREE_TRIAL_DAYS * 24 * 60 * 60 * 1000;

/**
 * `createdAt: null` (the tenant row itself doesn't exist) is never
 * within the allowance -- see TenantEligibilityFacts's own comment for
 * why this must be an explicit check, not a fallback date.
 *
 * `now` defaults to the real current time; a caller only ever overrides
 * it in a test. Needed for exactly one reason: on any date within
 * FREE_TRIAL_DAYS of FREE_TIER_ROLLOUT_DATE itself (true as of this
 * writing), no real timestamp can be BOTH "after rollout" and "more
 * than a trial-length ago" relative to the real Date.now() -- there
 * simply hasn't been enough real time yet. Exercising the "trial
 * genuinely expired" branch needs a controllable `now`, not a wait.
 */
export function withinFreeAllowance(createdAt: Date | null, now: Date = new Date()): boolean {
  if (createdAt === null) return false;
  if (createdAt < FREE_TIER_ROLLOUT_DATE) return true; // grandfathered
  return now.getTime() - createdAt.getTime() < FREE_TRIAL_MS;
}
