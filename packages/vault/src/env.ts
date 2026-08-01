// ADR-007: LocalKms must never run in production. NODE_ENV=production is
// the conventional signal; PRODUCTION=true is an explicit escape hatch for
// deployment setups that don't set NODE_ENV consistently.
export function isProductionEnvironment(): boolean {
  return process.env.NODE_ENV === "production" || process.env.PRODUCTION === "true";
}
