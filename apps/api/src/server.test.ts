import assert from "node:assert/strict";
import { test } from "node:test";
import { readServerConfigFromEnv } from "./server.js";

test("throws when DATABASE_URL is missing", () => {
  assert.throws(() => readServerConfigFromEnv({ BETTER_AUTH_SECRET: "s" } as NodeJS.ProcessEnv), /DATABASE_URL/);
});

test("throws when BETTER_AUTH_SECRET is missing", () => {
  assert.throws(
    () => readServerConfigFromEnv({ DATABASE_URL: "postgres://x" } as NodeJS.ProcessEnv),
    /BETTER_AUTH_SECRET/,
  );
});

test("defaults port to 3000, derives authBaseUrl from it, and defaults webOrigin to the web dev port", () => {
  const config = readServerConfigFromEnv({
    DATABASE_URL: "postgres://x",
    BETTER_AUTH_SECRET: "s",
  } as NodeJS.ProcessEnv);
  assert.equal(config.port, 3000);
  assert.equal(config.authBaseUrl, "http://localhost:3000");
  assert.equal(config.webOrigin, "http://localhost:3002");
});

test("respects an explicit PORT, BETTER_AUTH_URL, and WEB_ORIGIN", () => {
  const config = readServerConfigFromEnv({
    DATABASE_URL: "postgres://x",
    BETTER_AUTH_SECRET: "s",
    PORT: "4000",
    BETTER_AUTH_URL: "https://api.example.com",
    WEB_ORIGIN: "https://app.example.com",
  } as NodeJS.ProcessEnv);
  assert.equal(config.port, 4000);
  assert.equal(config.authBaseUrl, "https://api.example.com");
  assert.equal(config.webOrigin, "https://app.example.com");
});
