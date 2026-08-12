import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";

// CSRF protection for the Hands OAuth connect flow (PR 2B). Self-contained
// (HMAC-signed, no server-side storage) rather than a session/DB-backed
// nonce table: the callback route deliberately does NOT run inside
// tenantMiddleware's withTenantScope (see handsOAuth.ts's own comment —
// holding a pooled DB connection open across an external token-exchange
// HTTP call is exactly the kind of thing to avoid), so there's no natural
// place to store server-side state anyway, and a signed token survives a
// multi-replica deployment without needing shared storage.
const STATE_TTL_MS = 10 * 60_000; // generous for a real consent screen, short enough to bound replay

export interface OAuthStatePayload {
  tenantId: string;
  subAgentId: string;
  capabilityScope: string;
  service: string;
}

interface SignedStateBody extends OAuthStatePayload {
  nonce: string;
  issuedAt: number;
}

// Domain-separated from Better Auth's own use of the same secret (a
// distinct HMAC context string) — this reuses BETTER_AUTH_SECRET rather
// than requiring a new env var (it's already required, high-entropy, and
// present in every environment), but a token signed for this purpose can
// never be mistaken for a Better Auth session token or vice versa.
const HMAC_CONTEXT = "hands-oauth-state:v1";

function sign(secret: string, encodedBody: string): string {
  return createHmac("sha256", secret).update(`${HMAC_CONTEXT}:${encodedBody}`).digest("hex");
}

export function createOAuthState(secret: string, payload: OAuthStatePayload): string {
  const body: SignedStateBody = { ...payload, nonce: randomUUID(), issuedAt: Date.now() };
  const encoded = Buffer.from(JSON.stringify(body), "utf8").toString("base64url");
  return `${encoded}.${sign(secret, encoded)}`;
}

export class InvalidOAuthStateError extends Error {}

/** Verifies the HMAC signature (constant-time) and expiry, then returns
 *  the embedded payload. Throws InvalidOAuthStateError on any failure —
 *  malformed, tampered, or expired all fail the same way, deliberately:
 *  the callback route's only correct response to any of these is "start
 *  the connect flow again," not a different error per cause. */
export function verifyOAuthState(secret: string, state: string): OAuthStatePayload {
  const dotIndex = state.lastIndexOf(".");
  if (dotIndex === -1) throw new InvalidOAuthStateError("Malformed state.");
  const encoded = state.slice(0, dotIndex);
  const signature = state.slice(dotIndex + 1);

  const expected = sign(secret, encoded);
  const actual = Buffer.from(signature, "hex");
  const expectedBuf = Buffer.from(expected, "hex");
  if (actual.length !== expectedBuf.length || !timingSafeEqual(actual, expectedBuf)) {
    throw new InvalidOAuthStateError("State signature mismatch — possible CSRF or a stale link.");
  }

  let parsed: SignedStateBody;
  try {
    parsed = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch {
    throw new InvalidOAuthStateError("Malformed state payload.");
  }

  if (Date.now() - parsed.issuedAt > STATE_TTL_MS) {
    throw new InvalidOAuthStateError("State expired — start the connect flow again.");
  }

  const { tenantId, subAgentId, capabilityScope, service } = parsed;
  return { tenantId, subAgentId, capabilityScope, service };
}
