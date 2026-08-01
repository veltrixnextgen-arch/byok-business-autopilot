/**
 * Step-up (fresh MFA re-verification) permission concept — security-architecture.md
 * T6: these four operations must never proceed on session-level auth alone,
 * even after MFA-at-login. Enforcement hooks exist now so nothing shipped
 * later (an API route, a UI action) can accidentally skip this gate; the
 * actual UI/prompt for re-verification is out of scope for the shell.
 */
export const STEP_UP_OPERATIONS = ["key_ops", "ceiling_change", "autonomy_grant", "deploy_approval"] as const;

export type StepUpOperation = (typeof STEP_UP_OPERATIONS)[number];

export function isStepUpOperation(value: string): value is StepUpOperation {
  return (STEP_UP_OPERATIONS as readonly string[]).includes(value);
}

export interface StepUpAssertion {
  verifiedAt: Date;
  method: "totp" | "webauthn";
}

export class StepUpRequiredError extends Error {
  constructor(
    public readonly operation: StepUpOperation,
    reason: string,
  ) {
    super(`Step-up (MFA re-verification) required for "${operation}": ${reason}`);
    this.name = "StepUpRequiredError";
  }
}

const DEFAULT_FRESHNESS_MS = 5 * 60 * 1000;

/**
 * Throws StepUpRequiredError unless `assertion` records an MFA
 * re-verification within `freshnessMs` of `now`. A session-level
 * `twoFactorEnabled` flag from login is not sufficient on its own — this
 * requires a *fresh* re-verification scoped to the specific request.
 */
export function assertStepUp(
  operation: StepUpOperation,
  assertion: StepUpAssertion | undefined,
  now: Date = new Date(),
  freshnessMs: number = DEFAULT_FRESHNESS_MS,
): void {
  if (!assertion) {
    throw new StepUpRequiredError(operation, "no MFA re-verification on record for this request");
  }
  const ageMs = now.getTime() - assertion.verifiedAt.getTime();
  if (ageMs < 0 || ageMs > freshnessMs) {
    throw new StepUpRequiredError(operation, `MFA re-verification is stale (${Math.round(ageMs / 1000)}s old)`);
  }
}
