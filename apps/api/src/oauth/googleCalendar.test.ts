import { test } from "node:test";
import assert from "node:assert/strict";
import { HandsRefreshTokenRevokedError } from "@byok/vault";
import {
  createGoogleCalendarRefresher,
  exchangeGoogleCalendarCode,
  googleCalendarAuthorizeUrl,
  GoogleOAuthExchangeError,
  type GoogleOAuthConfig,
} from "./googleCalendar.js";

const CONFIG: GoogleOAuthConfig = {
  clientId: "client-1",
  clientSecret: "secret-1",
  redirectUri: "https://api.example.com/hands-oauth/google-calendar/callback",
};

type FakeResponder = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

function withFakeFetch<T>(responder: FakeResponder, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    return responder(url, init);
  }) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("googleCalendarAuthorizeUrl includes the narrow calendar.events scope, offline access, and forces prompt=consent", () => {
  const url = new URL(googleCalendarAuthorizeUrl(CONFIG, "state-abc"));
  assert.equal(url.origin + url.pathname, "https://accounts.google.com/o/oauth2/v2/auth");
  assert.equal(url.searchParams.get("scope"), "https://www.googleapis.com/auth/calendar.events");
  assert.equal(url.searchParams.get("access_type"), "offline");
  assert.equal(url.searchParams.get("prompt"), "consent");
  assert.equal(url.searchParams.get("state"), "state-abc");
  assert.equal(url.searchParams.get("client_id"), "client-1");
  assert.equal(url.searchParams.get("redirect_uri"), CONFIG.redirectUri);
});

test("exchangeGoogleCalendarCode returns a structured credential on success", async () => {
  const result = await withFakeFetch(
    () => jsonResponse(200, { access_token: "tok-1", refresh_token: "refresh-1", expires_in: 3600, scope: "calendar.events" }),
    () => exchangeGoogleCalendarCode(CONFIG, "auth-code-1"),
  );
  assert.equal(result.accessToken, "tok-1");
  assert.equal(result.refreshToken, "refresh-1");
  assert.equal(result.scope, "calendar.events");
  assert.ok(new Date(result.expiresAt).getTime() > Date.now());
});

test("exchangeGoogleCalendarCode throws GoogleOAuthExchangeError on a non-2xx response — never returns a partial credential", async () => {
  await assert.rejects(
    () => withFakeFetch(() => new Response("invalid_grant", { status: 400 }), () => exchangeGoogleCalendarCode(CONFIG, "bad-code")),
    GoogleOAuthExchangeError,
  );
});

test("exchangeGoogleCalendarCode throws GoogleOAuthExchangeError if the response is 200 but has no access_token", async () => {
  await assert.rejects(
    () => withFakeFetch(() => jsonResponse(200, { expires_in: 3600 }), () => exchangeGoogleCalendarCode(CONFIG, "code")),
    GoogleOAuthExchangeError,
  );
});

test("the refresher returns a fresh access token on success, matching PR 2A's RefreshedCredential shape", async () => {
  const refresher = createGoogleCalendarRefresher(CONFIG);
  const result = await withFakeFetch(
    () => jsonResponse(200, { access_token: "tok-refreshed", expires_in: 3600 }),
    () => refresher.refresh("refresh-1"),
  );
  assert.equal(result.accessToken, "tok-refreshed");
  assert.ok(new Date(result.expiresAt).getTime() > Date.now());
});

test("the refresher classifies a 400 invalid_grant response as HandsRefreshTokenRevokedError specifically", async () => {
  await assert.rejects(
    () =>
      withFakeFetch(
        () => new Response(JSON.stringify({ error: "invalid_grant", error_description: "Token has been expired or revoked." }), { status: 400 }),
        () => createGoogleCalendarRefresher(CONFIG).refresh("dead-refresh-token"),
      ),
    HandsRefreshTokenRevokedError,
  );
});

test("the refresher throws a plain Error (not HandsRefreshTokenRevokedError) on other failures, e.g. a 500", async () => {
  await assert.rejects(
    () => withFakeFetch(() => new Response("server error", { status: 500 }), () => createGoogleCalendarRefresher(CONFIG).refresh("refresh-1")),
    (err: unknown) => err instanceof Error && !(err instanceof HandsRefreshTokenRevokedError),
  );
});

test("the refresher throws if the response is 200 but has no access_token", async () => {
  await assert.rejects(
    () => withFakeFetch(() => jsonResponse(200, { expires_in: 3600 }), () => createGoogleCalendarRefresher(CONFIG).refresh("refresh-1")),
    Error,
  );
});
