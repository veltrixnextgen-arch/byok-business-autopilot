import assert from "node:assert/strict";
import { Hono } from "hono";
import { test } from "node:test";
import type { Auth } from "@byok/auth";
import { KeyNotFoundError, type PublicKeyRecord, type StoreHandsKeyInput } from "@byok/vault";
import type { AppEnv, AppSession } from "../context.js";
import { createOAuthState } from "../oauth/state.js";
import { GOOGLE_CALENDAR_SERVICE, type GoogleOAuthConfig } from "../oauth/googleCalendar.js";
import { handsOAuthRoute, type HandsOAuthRouteDeps } from "./handsOAuth.js";

const STATE_SECRET = "test-state-secret-0001";
const WEB_ORIGIN = "https://app.example.com";
const GOOGLE: GoogleOAuthConfig = {
  clientId: "client-1",
  clientSecret: "secret-1",
  redirectUri: "https://api.example.com/hands-oauth/google-calendar/callback",
};

function sessionFor(tenantId: string | null, userId = "user-1"): AppSession {
  if (!tenantId) return null as unknown as AppSession;
  return { user: { id: userId, email: "cfo@example.com" }, session: { activeOrganizationId: tenantId } } as unknown as AppSession;
}

function fakeAuth(session: AppSession): Pick<Auth, "api"> {
  return { api: { getSession: async () => session } as unknown as Auth["api"] };
}

function fakeVault(overrides: Partial<Pick<HandsOAuthRouteDeps["vault"], "storeHandsKey">> = {}) {
  // Snapshots plaintext to a string at call time — the real route zeroes
  // the Buffer in a `finally` right after this returns, so capturing a
  // reference to it (rather than its contents) would read back all-zero
  // bytes by the time a test asserts on it.
  const calls: Array<Omit<StoreHandsKeyInput, "plaintext"> & { plaintext: string }> = [];
  return {
    calls,
    storeHandsKey: async (input: StoreHandsKeyInput) => {
      calls.push({ ...input, plaintext: input.plaintext.toString("utf8") });
      return { id: "key-1" } as unknown as PublicKeyRecord;
    },
    ...overrides,
  };
}

function buildApp(deps: HandsOAuthRouteDeps) {
  return new Hono<AppEnv>().route("/", handsOAuthRoute(deps));
}

function locationOf(res: Response): URL {
  const loc = res.headers.get("location");
  assert.ok(loc, "expected a redirect Location header");
  return new URL(loc!);
}

// ---- /start -----------------------------------------------------------

test("start: 401s with no authenticated session, never issues a state token", async () => {
  const app = buildApp({ vault: fakeVault(), auth: fakeAuth(sessionFor(null)), stateSecret: STATE_SECRET, webOrigin: WEB_ORIGIN, google: GOOGLE });
  const res = await app.request(`/${GOOGLE_CALENDAR_SERVICE}/start?subAgentId=scheduling&capabilityScope=google-calendar:events`);
  assert.equal(res.status, 401);
});

test("start: 404s for an unregistered service — never builds an authorize URL for it", async () => {
  const app = buildApp({ vault: fakeVault(), auth: fakeAuth(sessionFor("tenant-1")), stateSecret: STATE_SECRET, webOrigin: WEB_ORIGIN, google: GOOGLE });
  const res = await app.request(`/some-unknown-service/start?subAgentId=scheduling&capabilityScope=x`, { redirect: "manual" });
  assert.equal(res.status, 404);
});

test("start: 404s for google-calendar when google config is null (not yet configured) — even though the service name matches", async () => {
  const app = buildApp({ vault: fakeVault(), auth: fakeAuth(sessionFor("tenant-1")), stateSecret: STATE_SECRET, webOrigin: WEB_ORIGIN, google: null });
  const res = await app.request(`/${GOOGLE_CALENDAR_SERVICE}/start?subAgentId=scheduling&capabilityScope=x`, { redirect: "manual" });
  assert.equal(res.status, 404);
});

test("start: redirects to Google's consent screen with a state token binding this exact tenant/subAgent/scope/service", async () => {
  const app = buildApp({ vault: fakeVault(), auth: fakeAuth(sessionFor("tenant-1")), stateSecret: STATE_SECRET, webOrigin: WEB_ORIGIN, google: GOOGLE });
  const res = await app.request(
    `/${GOOGLE_CALENDAR_SERVICE}/start?subAgentId=scheduling&capabilityScope=google-calendar:events`,
    { redirect: "manual" },
  );
  assert.equal(res.status, 302);
  const location = locationOf(res);
  assert.equal(location.origin, "https://accounts.google.com");
  assert.ok(location.searchParams.get("state"));
});

test("start: rejects a request missing subAgentId/capabilityScope with 400 before ever touching auth or the provider", async () => {
  const app = buildApp({ vault: fakeVault(), auth: fakeAuth(sessionFor("tenant-1")), stateSecret: STATE_SECRET, webOrigin: WEB_ORIGIN, google: GOOGLE });
  const res = await app.request(`/${GOOGLE_CALENDAR_SERVICE}/start?subAgentId=scheduling`);
  assert.equal(res.status, 400);
});

// ---- /callback ----------------------------------------------------------

function stateFor(overrides: Partial<{ tenantId: string; subAgentId: string; capabilityScope: string; service: string }> = {}) {
  return createOAuthState(STATE_SECRET, {
    tenantId: "tenant-1",
    subAgentId: "scheduling",
    capabilityScope: "google-calendar:events",
    service: GOOGLE_CALENDAR_SERVICE,
    ...overrides,
  });
}

test("callback: the provider declining consent (error=access_denied) redirects to an error state, stores nothing", async () => {
  const vault = fakeVault();
  const app = buildApp({ vault, auth: fakeAuth(sessionFor("tenant-1")), stateSecret: STATE_SECRET, webOrigin: WEB_ORIGIN, google: GOOGLE });
  const res = await app.request(`/${GOOGLE_CALENDAR_SERVICE}/callback?error=access_denied`, { redirect: "manual" });
  const location = locationOf(res);
  assert.equal(location.searchParams.get("handsOAuth"), "error");
  assert.equal(location.searchParams.get("reason"), "access_denied");
  assert.equal(vault.calls.length, 0);
});

test("callback: missing code or state redirects to an error state, stores nothing", async () => {
  const vault = fakeVault();
  const app = buildApp({ vault, auth: fakeAuth(sessionFor("tenant-1")), stateSecret: STATE_SECRET, webOrigin: WEB_ORIGIN, google: GOOGLE });
  const res = await app.request(`/${GOOGLE_CALENDAR_SERVICE}/callback?state=${stateFor()}`, { redirect: "manual" });
  assert.equal(locationOf(res).searchParams.get("reason"), "missing_code_or_state");
  assert.equal(vault.calls.length, 0);
});

test("callback: a tampered/invalid state redirects to an error state, stores nothing", async () => {
  const vault = fakeVault();
  const app = buildApp({ vault, auth: fakeAuth(sessionFor("tenant-1")), stateSecret: STATE_SECRET, webOrigin: WEB_ORIGIN, google: GOOGLE });
  const res = await app.request(`/${GOOGLE_CALENDAR_SERVICE}/callback?code=abc&state=not-a-real-state`, { redirect: "manual" });
  assert.equal(locationOf(res).searchParams.get("reason"), "invalid_state");
  assert.equal(vault.calls.length, 0);
});

test("callback: a valid state but no active session at callback time redirects to an error state, stores nothing", async () => {
  const vault = fakeVault();
  const app = buildApp({ vault, auth: fakeAuth(sessionFor(null)), stateSecret: STATE_SECRET, webOrigin: WEB_ORIGIN, google: GOOGLE });
  const res = await app.request(`/${GOOGLE_CALENDAR_SERVICE}/callback?code=abc&state=${stateFor()}`, { redirect: "manual" });
  assert.equal(locationOf(res).searchParams.get("reason"), "state_mismatch");
  assert.equal(vault.calls.length, 0);
});

test("callback: a state whose embedded tenantId doesn't match the LIVE session's tenant redirects to an error state, stores nothing — defense in depth against a replayed/leaked state link", async () => {
  const vault = fakeVault();
  // State was signed for tenant-1, but the browser completing the redirect
  // is now signed into tenant-2.
  const app = buildApp({ vault, auth: fakeAuth(sessionFor("tenant-2")), stateSecret: STATE_SECRET, webOrigin: WEB_ORIGIN, google: GOOGLE });
  const res = await app.request(`/${GOOGLE_CALENDAR_SERVICE}/callback?code=abc&state=${stateFor({ tenantId: "tenant-1" })}`, { redirect: "manual" });
  assert.equal(locationOf(res).searchParams.get("reason"), "state_mismatch");
  assert.equal(vault.calls.length, 0);
});

test("callback: a state for a different service than the URL path redirects to an error state, stores nothing", async () => {
  const vault = fakeVault();
  const app = buildApp({ vault, auth: fakeAuth(sessionFor("tenant-1")), stateSecret: STATE_SECRET, webOrigin: WEB_ORIGIN, google: GOOGLE });
  const res = await app.request(`/${GOOGLE_CALENDAR_SERVICE}/callback?code=abc&state=${stateFor({ service: "some-other-service" })}`, {
    redirect: "manual",
  });
  assert.equal(locationOf(res).searchParams.get("reason"), "state_mismatch");
  assert.equal(vault.calls.length, 0);
});

test("callback: a failed code exchange redirects to an error state, stores nothing", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response("bad request", { status: 400 })) as typeof fetch;
  try {
    const vault = fakeVault();
    const app = buildApp({ vault, auth: fakeAuth(sessionFor("tenant-1")), stateSecret: STATE_SECRET, webOrigin: WEB_ORIGIN, google: GOOGLE });
    const res = await app.request(`/${GOOGLE_CALENDAR_SERVICE}/callback?code=abc&state=${stateFor()}`, { redirect: "manual" });
    assert.equal(locationOf(res).searchParams.get("reason"), "exchange_failed");
    assert.equal(vault.calls.length, 0);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("callback: a successful exchange stores the credential through the oauth credentialKind path, scoped to the state's subAgentId+capabilityScope, and redirects connected", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ access_token: "tok-1", refresh_token: "refresh-1", expires_in: 3600, scope: "calendar.events" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  try {
    const vault = fakeVault();
    const app = buildApp({ vault, auth: fakeAuth(sessionFor("tenant-1")), stateSecret: STATE_SECRET, webOrigin: WEB_ORIGIN, google: GOOGLE });
    const res = await app.request(
      `/${GOOGLE_CALENDAR_SERVICE}/callback?code=abc&state=${stateFor({ subAgentId: "scheduling", capabilityScope: "google-calendar:events" })}`,
      { redirect: "manual" },
    );

    assert.equal(res.status, 302);
    assert.equal(locationOf(res).searchParams.get("handsOAuth"), "connected");
    assert.equal(vault.calls.length, 1);
    const stored = vault.calls[0]!;
    assert.equal(stored.tenantId, "tenant-1");
    assert.equal(stored.subAgentId, "scheduling");
    assert.equal(stored.capabilityScope, "google-calendar:events");
    assert.equal(stored.service, GOOGLE_CALENDAR_SERVICE);
    assert.equal(stored.credentialKind, "oauth");

    const credential = JSON.parse(stored.plaintext);
    assert.equal(credential.accessToken, "tok-1");
    assert.equal(credential.refreshToken, "refresh-1");
    assert.ok(credential.expiresAt);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("callback: a vault store failure redirects to an error state — never a partial connect", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(JSON.stringify({ access_token: "tok-1", expires_in: 3600 }), { status: 200, headers: { "content-type": "application/json" } })) as typeof fetch;
  try {
    const vault = fakeVault({
      storeHandsKey: async () => {
        throw new KeyNotFoundError("simulated vault failure");
      },
    });
    const app = buildApp({ vault, auth: fakeAuth(sessionFor("tenant-1")), stateSecret: STATE_SECRET, webOrigin: WEB_ORIGIN, google: GOOGLE });
    const res = await app.request(`/${GOOGLE_CALENDAR_SERVICE}/callback?code=abc&state=${stateFor()}`, { redirect: "manual" });
    assert.equal(locationOf(res).searchParams.get("reason"), "store_failed");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
