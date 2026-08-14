// ADR-007: LocalKms must never run in production. NODE_ENV=production is
// the conventional signal; PRODUCTION=true is an explicit escape hatch for
// deployment setups that don't set NODE_ENV consistently.
export function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === "production" || process.env.PRODUCTION === "true";
}

// ADR-026: the in-memory durable-store implementations (CostGate's
// reservation store, ApprovalQueue's pending-item store) exist for tests
// and `npm run dev` — genuinely functional, but single-process and reset
// on every restart. Staging reached NODE_ENV=staging via the exact same
// wiring as local dev for months (apps/api/src/dev/devTrustCore.ts) before
// anyone noticed, because nothing exercised the scheduler's unattended
// dispatch path until R3. This is the inverse of isProductionEnvironment:
// an explicit allowlist (undefined/"development"/"test"), not a
// denylist — a new deploy target added later defaults to REFUSED, not
// silently accepted, which is the direction this class of bug needs to
// fail in.
export function isDevOrTestEnvironment(): boolean {
  const env = process.env.NODE_ENV;
  return env === undefined || env === "development" || env === "test";
}
