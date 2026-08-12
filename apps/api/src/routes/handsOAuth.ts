import type { Auth } from "@byok/auth";
import type { Vault } from "@byok/vault";
import { Hono } from "hono";
import { z } from "zod";
import { zValidator } from "@hono/zod-validator";
import type { AppEnv } from "../context.js";
import {
  exchangeGoogleCalendarCode,
  googleCalendarAuthorizeUrl,
  GOOGLE_CALENDAR_SERVICE,
  type GoogleOAuthConfig,
} from "../oauth/googleCalendar.js";
import { createOAuthState, InvalidOAuthStateError, verifyOAuthState } from "../oauth/state.js";

export interface HandsOAuthRouteDeps {
  vault: Pick<Vault, "storeHandsKey">;
  /** Only .api.getSession is used, and deliberately NOT via
   *  tenantMiddleware — see the route comment below for why. */
  auth: Pick<Auth, "api">;
  /** Signs/verifies the CSRF state param — reuses BETTER_AUTH_SECRET
   *  (ADR-021), passed in rather than read from env here to keep env
   *  access centralized in server.ts. */
  stateSecret: string;
  webOrigin: string;
  /** null until GOOGLE_OAUTH_CLIENT_ID/SECRET are configured (server.ts) —
   *  the route stays mounted either way; /start and /callback both 4xx
   *  cleanly with "not connectable yet" rather than the whole app failing
   *  to boot. Adding a second provider (e.g. Meta) is one more optional
   *  field here plus its own oauth/*.ts module, not a redesign. */
  google: GoogleOAuthConfig | null;
}

const startQuerySchema = z.object({
  subAgentId: z.string().min(1),
  capabilityScope: z.string().min(1),
});

function redirectToOrgChart(webOrigin: string, status: "connected" | "error", reason?: string) {
  const url = new URL("/org-chart", webOrigin);
  url.searchParams.set("handsOAuth", status);
  if (reason) url.searchParams.set("reason", reason);
  return url.toString();
}

/**
 * OAuth Hands connect (PR 2B, following ADR-020's provider-agnostic
 * design through to a real integration). Two routes:
 *
 * GET /:service/start — begins the flow. Requires an authenticated
 * session with an active tenant (checked directly via auth.api.getSession,
 * NOT tenantMiddleware — see /:service/callback below for why the same
 * choice applies here too, for consistency). Issues a signed, short-lived
 * state token binding this exact (tenantId, subAgentId, capabilityScope,
 * service), then 302s to the provider's consent screen. Meant to be
 * reached via a plain `<a href>` navigation from the org chart's Hands
 * badge, never fetch() — this is a top-level redirect chain, not an API
 * call, so it's outside CORS entirely.
 *
 * GET /:service/callback — where the provider redirects back. Deliberately
 * NOT wrapped in tenantMiddleware: that middleware holds a pooled Postgres
 * connection open for the entire request via withTenantScope, and this
 * request's own body is an external HTTP round-trip to the provider's
 * token endpoint — tying up a DB connection for the duration of a
 * third-party network call is exactly the kind of thing to avoid, and
 * storeHandsKey doesn't touch the SQL pool at all (Vault is KMS/in-memory
 * in this deployment, see devTrustCore.ts). Session is still checked
 * directly, and cross-checked against the state's embedded tenantId —
 * defense in depth (security-architecture.md's isolation principle): the
 * signed state alone proves the request traces back to a /start call this
 * server issued, but the live-session cross-check means a leaked or
 * replayed state link can't be completed from a different signed-in
 * tenant either.
 *
 * Fail-closed throughout: the provider declining consent, a state
 * mismatch, a failed code exchange, or a vault store failure all redirect
 * with handsOAuth=error and store nothing — there is no code path that
 * writes a partial or placeholder credential. A stored credential is
 * always the real, complete thing PR 2A's decryptHandsKey expects, or
 * nothing is stored at all.
 */
export function handsOAuthRoute(deps: HandsOAuthRouteDeps) {
  return new Hono<AppEnv>()
    .get("/:service/start", zValidator("query", startQuerySchema), async (c) => {
      const service = c.req.param("service");
      const { subAgentId, capabilityScope } = c.req.valid("query");

      const session = await deps.auth.api.getSession({ headers: c.req.raw.headers });
      const tenantId = session?.session.activeOrganizationId;
      if (!session || !tenantId) {
        return c.json({ error: "No authenticated session with an active tenant" }, 401);
      }

      if (service !== GOOGLE_CALENDAR_SERVICE || !deps.google) {
        return c.json({ error: `"${service}" isn't connectable yet.` }, 404);
      }

      const state = createOAuthState(deps.stateSecret, { tenantId, subAgentId, capabilityScope, service });
      return c.redirect(googleCalendarAuthorizeUrl(deps.google, state), 302);
    })
    .get("/:service/callback", async (c) => {
      const service = c.req.param("service");
      const code = c.req.query("code");
      const stateParam = c.req.query("state");
      const providerError = c.req.query("error"); // e.g. Google sends error=access_denied if the user declines

      if (providerError) return c.redirect(redirectToOrgChart(deps.webOrigin, "error", providerError), 302);
      if (!code || !stateParam) return c.redirect(redirectToOrgChart(deps.webOrigin, "error", "missing_code_or_state"), 302);

      let statePayload;
      try {
        statePayload = verifyOAuthState(deps.stateSecret, stateParam);
      } catch (err) {
        const reason = err instanceof InvalidOAuthStateError ? "invalid_state" : "state_verification_failed";
        return c.redirect(redirectToOrgChart(deps.webOrigin, "error", reason), 302);
      }

      const session = await deps.auth.api.getSession({ headers: c.req.raw.headers });
      const tenantId = session?.session.activeOrganizationId;
      if (!session || !tenantId || statePayload.tenantId !== tenantId || statePayload.service !== service) {
        return c.redirect(redirectToOrgChart(deps.webOrigin, "error", "state_mismatch"), 302);
      }

      if (service !== GOOGLE_CALENDAR_SERVICE || !deps.google) {
        return c.redirect(redirectToOrgChart(deps.webOrigin, "error", "not_configured"), 302);
      }

      let exchanged;
      try {
        exchanged = await exchangeGoogleCalendarCode(deps.google, code);
      } catch {
        return c.redirect(redirectToOrgChart(deps.webOrigin, "error", "exchange_failed"), 302);
      }

      const plaintext = Buffer.from(
        JSON.stringify({
          accessToken: exchanged.accessToken,
          refreshToken: exchanged.refreshToken,
          expiresAt: exchanged.expiresAt,
          scope: exchanged.scope,
        }),
        "utf8",
      );
      try {
        await deps.vault.storeHandsKey(
          {
            tenantId,
            subAgentId: statePayload.subAgentId,
            capabilityScope: statePayload.capabilityScope,
            service,
            plaintext,
            credentialKind: "oauth",
          },
          { kind: "tenant-user", userId: session.user.id },
        );
      } catch {
        return c.redirect(redirectToOrgChart(deps.webOrigin, "error", "store_failed"), 302);
      } finally {
        plaintext.fill(0);
      }

      return c.redirect(redirectToOrgChart(deps.webOrigin, "connected"), 302);
    });
}
