import assert from "node:assert/strict";
import { test } from "node:test";
import { readServerConfigFromEnv } from "./server.js";

test("throws when DATABASE_URL is missing", () => {
  assert.throws(
    () => readServerConfigFromEnv({ BETTER_AUTH_SECRET: "s", ANTHROPIC_API_KEY: "k", INTERNAL_METRICS_TOKEN: "t" } as NodeJS.ProcessEnv),
    /DATABASE_URL/,
  );
});

test("throws when BETTER_AUTH_SECRET is missing", () => {
  assert.throws(
    () =>
      readServerConfigFromEnv({
        DATABASE_URL: "postgres://x",
        ANTHROPIC_API_KEY: "k",
        INTERNAL_METRICS_TOKEN: "t",
      } as NodeJS.ProcessEnv),
    /BETTER_AUTH_SECRET/,
  );
});

test("throws when ANTHROPIC_API_KEY is missing", () => {
  assert.throws(
    () =>
      readServerConfigFromEnv({
        DATABASE_URL: "postgres://x",
        BETTER_AUTH_SECRET: "s",
        INTERNAL_METRICS_TOKEN: "t",
      } as NodeJS.ProcessEnv),
    /ANTHROPIC_API_KEY/,
  );
});

test("throws when INTERNAL_METRICS_TOKEN is missing", () => {
  assert.throws(
    () =>
      readServerConfigFromEnv({
        DATABASE_URL: "postgres://x",
        BETTER_AUTH_SECRET: "s",
        ANTHROPIC_API_KEY: "k",
      } as NodeJS.ProcessEnv),
    /INTERNAL_METRICS_TOKEN/,
  );
});

// R3/ADR-025: REDIS_URL backs the scheduler's BullMQ queue — required,
// same discipline as every other credential in this file.
test("throws when REDIS_URL is missing", () => {
  assert.throws(
    () =>
      readServerConfigFromEnv({
        DATABASE_URL: "postgres://x",
        BETTER_AUTH_SECRET: "s",
        ANTHROPIC_API_KEY: "k",
        INTERNAL_METRICS_TOKEN: "t",
      } as NodeJS.ProcessEnv),
    /REDIS_URL/,
  );
});

test("defaults port to 3000, derives authBaseUrl from it, and defaults webOrigin to the web dev port", () => {
  const config = readServerConfigFromEnv({
    DATABASE_URL: "postgres://x",
    BETTER_AUTH_SECRET: "s",
    ANTHROPIC_API_KEY: "k",
    INTERNAL_METRICS_TOKEN: "t",
    REDIS_URL: "redis://x",
  } as NodeJS.ProcessEnv);
  assert.equal(config.port, 3000);
  assert.equal(config.authBaseUrl, "http://localhost:3000");
  assert.equal(config.webOrigin, "http://localhost:3002");
});

// ADR-029: BUILD_SHA is deliberately not required — local dev (and any
// environment that hasn't opted in) has none, and the server must still
// boot; "unknown" is the honest default, not a bug.
test("buildSha defaults to 'unknown' when BUILD_SHA is unset", () => {
  const config = readServerConfigFromEnv({
    DATABASE_URL: "postgres://x",
    BETTER_AUTH_SECRET: "s",
    ANTHROPIC_API_KEY: "k",
    INTERNAL_METRICS_TOKEN: "t",
    REDIS_URL: "redis://x",
  } as NodeJS.ProcessEnv);
  assert.equal(config.buildSha, "unknown");
});

test("buildSha is read verbatim from BUILD_SHA when set (deploy-staging.yml sets it to $GITHUB_SHA)", () => {
  const config = readServerConfigFromEnv({
    DATABASE_URL: "postgres://x",
    BETTER_AUTH_SECRET: "s",
    ANTHROPIC_API_KEY: "k",
    INTERNAL_METRICS_TOKEN: "t",
    REDIS_URL: "redis://x",
    BUILD_SHA: "a1b2c3d4",
  } as NodeJS.ProcessEnv);
  assert.equal(config.buildSha, "a1b2c3d4");
});

test("respects an explicit PORT, BETTER_AUTH_URL, and WEB_ORIGIN", () => {
  const config = readServerConfigFromEnv({
    DATABASE_URL: "postgres://x",
    BETTER_AUTH_SECRET: "s",
    ANTHROPIC_API_KEY: "k",
    INTERNAL_METRICS_TOKEN: "t",
    REDIS_URL: "redis://x",
    PORT: "4000",
    BETTER_AUTH_URL: "https://api.example.com",
    WEB_ORIGIN: "https://app.example.com",
  } as NodeJS.ProcessEnv);
  assert.equal(config.port, 4000);
  assert.equal(config.authBaseUrl, "https://api.example.com");
  assert.equal(config.webOrigin, "https://app.example.com");
});

// The CORS-outage-on-domain-change bug: WEB_ORIGIN alone can only ever
// trust one exact origin, which is exactly what broke sign-in the moment
// this product moved onto a real domain with both a www and bare-apex
// form. webOrigins is the fix's actual surface — always includes
// webOrigin, additive from ADDITIONAL_WEB_ORIGINS.
test("webOrigins defaults to exactly [webOrigin] when ADDITIONAL_WEB_ORIGINS is unset", () => {
  const config = readServerConfigFromEnv({
    DATABASE_URL: "postgres://x",
    BETTER_AUTH_SECRET: "s",
    ANTHROPIC_API_KEY: "k",
    INTERNAL_METRICS_TOKEN: "t",
    REDIS_URL: "redis://x",
    WEB_ORIGIN: "https://app.example.com",
  } as NodeJS.ProcessEnv);
  assert.deepEqual(config.webOrigins, ["https://app.example.com"]);
});

test("ADDITIONAL_WEB_ORIGINS adds extra trusted origins alongside webOrigin, comma-separated and trimmed", () => {
  const config = readServerConfigFromEnv({
    DATABASE_URL: "postgres://x",
    BETTER_AUTH_SECRET: "s",
    ANTHROPIC_API_KEY: "k",
    INTERNAL_METRICS_TOKEN: "t",
    REDIS_URL: "redis://x",
    WEB_ORIGIN: "https://www.runwisely.cc",
    ADDITIONAL_WEB_ORIGINS: "https://runwisely.cc, https://runwisely-autopilot.vercel.app",
  } as NodeJS.ProcessEnv);
  assert.deepEqual(config.webOrigins, [
    "https://www.runwisely.cc",
    "https://runwisely.cc",
    "https://runwisely-autopilot.vercel.app",
  ]);
});

test("ADDITIONAL_WEB_ORIGINS ignores empty entries and never duplicates webOrigin", () => {
  const config = readServerConfigFromEnv({
    DATABASE_URL: "postgres://x",
    BETTER_AUTH_SECRET: "s",
    ANTHROPIC_API_KEY: "k",
    INTERNAL_METRICS_TOKEN: "t",
    REDIS_URL: "redis://x",
    WEB_ORIGIN: "https://www.runwisely.cc",
    ADDITIONAL_WEB_ORIGINS: ",https://www.runwisely.cc,,https://runwisely.cc,",
  } as NodeJS.ProcessEnv);
  assert.deepEqual(config.webOrigins, ["https://www.runwisely.cc", "https://runwisely.cc"]);
});

test("crossSiteCookies defaults to false (SameSite=None needs HTTPS, which local dev doesn't have)", () => {
  const config = readServerConfigFromEnv({
    DATABASE_URL: "postgres://x",
    BETTER_AUTH_SECRET: "s",
    ANTHROPIC_API_KEY: "k",
    INTERNAL_METRICS_TOKEN: "t",
    REDIS_URL: "redis://x",
  } as NodeJS.ProcessEnv);
  assert.equal(config.crossSiteCookies, false);
});

test("crossSiteCookies is true only when CROSS_SITE_COOKIES=true exactly", () => {
  const config = readServerConfigFromEnv({
    DATABASE_URL: "postgres://x",
    BETTER_AUTH_SECRET: "s",
    ANTHROPIC_API_KEY: "k",
    INTERNAL_METRICS_TOKEN: "t",
    REDIS_URL: "redis://x",
    CROSS_SITE_COOKIES: "true",
  } as NodeJS.ProcessEnv);
  assert.equal(config.crossSiteCookies, true);
});

// PR 2B (ADR-021): google is optional, unlike every other credential in
// this file — the server must still boot with it entirely unset, since
// that's every environment today pending Google's app verification.
test("google is null when GOOGLE_OAUTH_CLIENT_ID/SECRET are both unset — server still boots fine", () => {
  const config = readServerConfigFromEnv({
    DATABASE_URL: "postgres://x",
    BETTER_AUTH_SECRET: "s",
    ANTHROPIC_API_KEY: "k",
    INTERNAL_METRICS_TOKEN: "t",
    REDIS_URL: "redis://x",
  } as NodeJS.ProcessEnv);
  assert.equal(config.google, null);
});

test("google is null when only one of GOOGLE_OAUTH_CLIENT_ID/SECRET is set — never a half-configured provider", () => {
  const config = readServerConfigFromEnv({
    DATABASE_URL: "postgres://x",
    BETTER_AUTH_SECRET: "s",
    ANTHROPIC_API_KEY: "k",
    INTERNAL_METRICS_TOKEN: "t",
    REDIS_URL: "redis://x",
    GOOGLE_OAUTH_CLIENT_ID: "client-1",
  } as NodeJS.ProcessEnv);
  assert.equal(config.google, null);
});

test("google is populated with a redirectUri derived from authBaseUrl once both env vars are set", () => {
  const config = readServerConfigFromEnv({
    DATABASE_URL: "postgres://x",
    BETTER_AUTH_SECRET: "s",
    ANTHROPIC_API_KEY: "k",
    INTERNAL_METRICS_TOKEN: "t",
    REDIS_URL: "redis://x",
    GOOGLE_OAUTH_CLIENT_ID: "client-1",
    GOOGLE_OAUTH_CLIENT_SECRET: "secret-1",
    BETTER_AUTH_URL: "https://api.example.com",
  } as NodeJS.ProcessEnv);
  assert.deepEqual(config.google, {
    clientId: "client-1",
    clientSecret: "secret-1",
    redirectUri: "https://api.example.com/api/hands-oauth/google-calendar/callback",
  });
});

// Issue #18/ADR-045: stripe is optional, same reasoning as google above —
// no real Stripe account exists yet anywhere this app runs, and the
// server must still boot with it entirely unset.
const STRIPE_PRICE_ENV = {
  STRIPE_PRICE_MONTHLY: "price_monthly",
  STRIPE_PRICE_QUARTERLY: "price_quarterly",
  STRIPE_PRICE_YEARLY: "price_yearly",
};

test("stripe is null when STRIPE_SECRET_KEY is unset — server still boots fine", () => {
  const config = readServerConfigFromEnv({
    DATABASE_URL: "postgres://x",
    BETTER_AUTH_SECRET: "s",
    ANTHROPIC_API_KEY: "k",
    INTERNAL_METRICS_TOKEN: "t",
    REDIS_URL: "redis://x",
  } as NodeJS.ProcessEnv);
  assert.equal(config.stripe, null);
});

test("stripe is null when STRIPE_SECRET_KEY is set but STRIPE_WEBHOOK_SECRET is missing — never a half-configured account", () => {
  const config = readServerConfigFromEnv({
    DATABASE_URL: "postgres://x",
    BETTER_AUTH_SECRET: "s",
    ANTHROPIC_API_KEY: "k",
    INTERNAL_METRICS_TOKEN: "t",
    REDIS_URL: "redis://x",
    STRIPE_SECRET_KEY: "sk_test_x",
  } as NodeJS.ProcessEnv);
  assert.equal(config.stripe, null);
});

test("throws when STRIPE_SECRET_KEY/WEBHOOK_SECRET are both set but a STRIPE_PRICE_* var is missing", () => {
  assert.throws(
    () =>
      readServerConfigFromEnv({
        DATABASE_URL: "postgres://x",
        BETTER_AUTH_SECRET: "s",
        ANTHROPIC_API_KEY: "k",
        INTERNAL_METRICS_TOKEN: "t",
        REDIS_URL: "redis://x",
        STRIPE_SECRET_KEY: "sk_test_x",
        STRIPE_WEBHOOK_SECRET: "whsec_x",
        // STRIPE_PRICE_MONTHLY deliberately omitted
        STRIPE_PRICE_QUARTERLY: "price_quarterly",
        STRIPE_PRICE_YEARLY: "price_yearly",
      } as NodeJS.ProcessEnv),
    /STRIPE_PRICE_MONTHLY/,
  );
});

test("stripe is fully populated once the secret/webhook keys and all three price ids are set", () => {
  const config = readServerConfigFromEnv({
    DATABASE_URL: "postgres://x",
    BETTER_AUTH_SECRET: "s",
    ANTHROPIC_API_KEY: "k",
    INTERNAL_METRICS_TOKEN: "t",
    REDIS_URL: "redis://x",
    STRIPE_SECRET_KEY: "sk_test_x",
    STRIPE_WEBHOOK_SECRET: "whsec_x",
    ...STRIPE_PRICE_ENV,
  } as NodeJS.ProcessEnv);
  assert.deepEqual(config.stripe, {
    secretKey: "sk_test_x",
    webhookSecret: "whsec_x",
    priceMap: {
      monthly: "price_monthly",
      quarterly: "price_quarterly",
      yearly: "price_yearly",
    },
  });
});
