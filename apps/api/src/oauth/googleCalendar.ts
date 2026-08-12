import { HandsRefreshTokenRevokedError } from "@byok/vault";
import type { HandsCredentialRefresher, RefreshedCredential } from "@byok/vault";

// Google Calendar OAuth (PR 2B). §2g's ranking (docs/design/tool-registry.md)
// picked this as the first Hands OAuth integration to build — highest
// sub-agent reach (Scheduling, Event coordinator) with a one-time,
// non-CASA-tier verification gate. See docs/design/google-oauth-verification-checklist.md
// for the submission checklist and docs/DECISIONS.md ADR-021 for the
// design decisions (why HMAC state, why client secret in env not vault).
export const GOOGLE_CALENDAR_SERVICE = "google-calendar";

// calendar.events, not the blanket calendar scope — narrowest scope that
// covers Scheduling/Event coordinator's actual read+write-events need
// (tool-registry.md §2g's own recommendation, carried into the code that
// implements it rather than left as a research note nobody enforces).
const CALENDAR_SCOPE = "https://www.googleapis.com/auth/calendar.events";
const GOOGLE_AUTHORIZE_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

export interface GoogleOAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
}

export function googleCalendarAuthorizeUrl(config: GoogleOAuthConfig, state: string): string {
  const url = new URL(GOOGLE_AUTHORIZE_URL);
  url.searchParams.set("client_id", config.clientId);
  url.searchParams.set("redirect_uri", config.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", CALENDAR_SCOPE);
  // offline + prompt=consent together are what actually guarantee a
  // refresh_token comes back — Google only issues one on a genuine
  // consent grant; without prompt=consent, a user who already granted
  // access once (even for a different scope combination) can silently
  // get a code-exchange response with no refresh_token at all, which
  // would make PR 2A's refresh path permanently unreachable for them.
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");
  url.searchParams.set("state", state);
  return url.toString();
}

interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope?: string;
  token_type: string;
}

export class GoogleOAuthExchangeError extends Error {}

export interface ExchangedGoogleCredential {
  accessToken: string;
  refreshToken?: string;
  expiresAt: string;
  scope?: string;
}

function expiresAtFrom(expiresInSeconds: number): string {
  return new Date(Date.now() + expiresInSeconds * 1000).toISOString();
}

/** Server-side authorization-code exchange only — the client secret this
 *  needs never reaches the browser (ADR-021). Any non-2xx or a response
 *  missing access_token is a clean GoogleOAuthExchangeError; the caller
 *  (handsOAuth.ts) treats that as "nothing to store," never a partial
 *  credential. */
export async function exchangeGoogleCalendarCode(config: GoogleOAuthConfig, code: string): Promise<ExchangedGoogleCredential> {
  const res = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: config.clientId,
      client_secret: config.clientSecret,
      redirect_uri: config.redirectUri,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) {
    throw new GoogleOAuthExchangeError(`Google token exchange failed (${res.status}): ${await safeText(res)}`);
  }
  const data = (await res.json()) as GoogleTokenResponse;
  if (!data.access_token) throw new GoogleOAuthExchangeError("Google token exchange response had no access_token.");
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: expiresAtFrom(data.expires_in),
    scope: data.scope,
  };
}

/** The HandsCredentialRefresher registered into Vault (PR 2A's
 *  provider-agnostic interface) — this is the only Google-specific piece
 *  the vault's generic refresh orchestration (expiry check, single-flight,
 *  timeout, re-encrypt-in-place, fail-closed classification) needs.
 *  Classifies Google's invalid_grant response as
 *  HandsRefreshTokenRevokedError specifically (triggers real key
 *  revocation in the vault, see ADR-020) — every other failure is a plain
 *  Error, which decryptHandsKey wraps as the transient
 *  HandsRefreshFailedError. */
export function createGoogleCalendarRefresher(config: Pick<GoogleOAuthConfig, "clientId" | "clientSecret">): HandsCredentialRefresher {
  return {
    async refresh(refreshToken: string): Promise<RefreshedCredential> {
      const res = await fetch(GOOGLE_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({
          refresh_token: refreshToken,
          client_id: config.clientId,
          client_secret: config.clientSecret,
          grant_type: "refresh_token",
        }),
      });
      if (!res.ok) {
        const body = await safeText(res);
        // Google's documented signal for "this refresh token is dead" —
        // https://developers.google.com/identity/protocols/oauth2/web-server#offline
        if (res.status === 400 && body.includes("invalid_grant")) {
          throw new HandsRefreshTokenRevokedError(`Google refresh token invalid_grant: ${body}`);
        }
        throw new Error(`Google token refresh failed (${res.status}): ${body}`);
      }
      const data = (await res.json()) as GoogleTokenResponse;
      if (!data.access_token) throw new Error("Google token refresh response had no access_token.");
      return { accessToken: data.access_token, expiresAt: expiresAtFrom(data.expires_in) };
    },
  };
}

async function safeText(res: Response): Promise<string> {
  try {
    return await res.text();
  } catch {
    return "";
  }
}
