import { assertStepUp, StepUpRequiredError, type StepUpOperation } from "@byok/auth";
import type { MiddlewareHandler } from "hono";
import type { AppEnv } from "../context.js";

/**
 * Reads step-up state from the server-verified session record populated by
 * tenantMiddleware — never from a client header, which would let a caller
 * claim "verified" without ever completing MFA. The write path (a route
 * that calls Better Auth's real TOTP verification and then persists
 * stepUpVerifiedAt/stepUpMethod onto the session — see
 * packages/auth/src/config.ts's session.additionalFields) isn't wired yet;
 * there's no UI to drive it. This is the enforcement hook the shell spec
 * asked for "in place even before the UI exists": once that route ships,
 * all four T6 operations are already gated correctly with zero changes
 * here.
 */
export function requireStepUp(operation: StepUpOperation): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const session = c.get("session").session as unknown as {
      stepUpVerifiedAt?: number | null;
      stepUpMethod?: string | null;
    };
    const { stepUpVerifiedAt, stepUpMethod } = session;
    const isRecognizedMethod = stepUpMethod === "totp" || stepUpMethod === "webauthn";

    const assertion =
      stepUpVerifiedAt != null && isRecognizedMethod
        ? { verifiedAt: new Date(stepUpVerifiedAt), method: stepUpMethod as "totp" | "webauthn" }
        : undefined;

    try {
      assertStepUp(operation, assertion);
    } catch (err) {
      if (err instanceof StepUpRequiredError) {
        return c.json({ error: err.message, operation: err.operation }, 403);
      }
      throw err;
    }

    await next();
  };
}
