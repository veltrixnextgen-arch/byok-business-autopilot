import { test } from "node:test";
import assert from "node:assert/strict";
import { BRAIN_PROVIDERS, isBrainProvider, validateBrainKey } from "./providerValidation.js";

type FakeResponder = (url: string, init: RequestInit | undefined) => Response | Promise<Response>;

function withFakeFetch<T>(responder: FakeResponder, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    calls.push({ url, init });
    return responder(url, init);
  }) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

test("BRAIN_PROVIDERS / isBrainProvider agree on the exact four providers the connect screen offers", () => {
  assert.deepEqual(BRAIN_PROVIDERS, ["anthropic", "openai", "google", "deepseek"]);
  for (const p of BRAIN_PROVIDERS) assert.equal(isBrainProvider(p), true);
  assert.equal(isBrainProvider("azure"), false);
  assert.equal(isBrainProvider(""), false);
});

test("anthropic: a working key resolves true, and the key reaches the provider as x-api-key", async () => {
  let sawAuthHeader: string | null = null;
  let sawVersionHeader: string | null = null;
  const ok = await withFakeFetch(
    (url, init) => {
      assert.equal(url, "https://api.anthropic.com/v1/models?limit=1");
      sawAuthHeader = new Headers(init?.headers).get("x-api-key");
      sawVersionHeader = new Headers(init?.headers).get("anthropic-version");
      return jsonResponse(200, { data: [], has_more: false, first_id: null, last_id: null });
    },
    () => validateBrainKey("anthropic", Buffer.from("sk-ant-real-key")),
  );

  assert.equal(ok, true);
  assert.equal(sawAuthHeader, "sk-ant-real-key");
  assert.ok(sawVersionHeader, "anthropic-version header must be set — the API rejects requests without one");
});

test("anthropic: a 401 resolves false, not a throw", async () => {
  const ok = await withFakeFetch(
    () => jsonResponse(401, { type: "error", error: { type: "authentication_error", message: "invalid x-api-key" } }),
    () => validateBrainKey("anthropic", Buffer.from("sk-ant-bad-key")),
  );

  assert.equal(ok, false);
});

test("anthropic: an unrelated upstream failure (5xx) still surfaces as a throw, not a silent false", async () => {
  await assert.rejects(() =>
    withFakeFetch(
      () => jsonResponse(500, { type: "error", error: { type: "api_error", message: "internal server error" } }),
      () => validateBrainKey("anthropic", Buffer.from("sk-ant-whatever")),
    ),
  );
});

test("openai: a working key resolves true, key sent as Bearer auth", async () => {
  let sawAuthHeader: string | null = null;
  const ok = await withFakeFetch(
    (url, init) => {
      assert.equal(url, "https://api.openai.com/v1/models");
      sawAuthHeader = new Headers(init?.headers).get("Authorization");
      return jsonResponse(200, { data: [] });
    },
    () => validateBrainKey("openai", Buffer.from("sk-real-key")),
  );

  assert.equal(ok, true);
  assert.equal(sawAuthHeader, "Bearer sk-real-key");
});

test("openai: a 401 resolves false", async () => {
  const ok = await withFakeFetch(
    () => jsonResponse(401, { error: { message: "Incorrect API key provided" } }),
    () => validateBrainKey("openai", Buffer.from("sk-bad-key")),
  );
  assert.equal(ok, false);
});

test("openai: a 5xx surfaces as a throw", async () => {
  await assert.rejects(() =>
    withFakeFetch(
      () => jsonResponse(500, { error: { message: "server error" } }),
      () => validateBrainKey("openai", Buffer.from("sk-whatever")),
    ),
  );
});

test("google: a working key resolves true, key sent as a query param", async () => {
  const ok = await withFakeFetch(
    (url) => {
      assert.equal(url, "https://generativelanguage.googleapis.com/v1beta/models?key=AIza-real-key");
      return jsonResponse(200, { models: [] });
    },
    () => validateBrainKey("google", Buffer.from("AIza-real-key")),
  );
  assert.equal(ok, true);
});

test("google: a 400 (its own shape for an invalid key) resolves false", async () => {
  const ok = await withFakeFetch(
    () => jsonResponse(400, { error: { code: 400, message: "API key not valid. Please pass a valid API key.", status: "INVALID_ARGUMENT" } }),
    () => validateBrainKey("google", Buffer.from("AIza-bad-key")),
  );
  assert.equal(ok, false);
});

test("google: a 5xx surfaces as a throw", async () => {
  await assert.rejects(() =>
    withFakeFetch(
      () => jsonResponse(503, { error: { message: "unavailable" } }),
      () => validateBrainKey("google", Buffer.from("AIza-whatever")),
    ),
  );
});

test("deepseek: a working key resolves true, key sent as Bearer auth", async () => {
  let sawAuthHeader: string | null = null;
  const ok = await withFakeFetch(
    (url, init) => {
      assert.equal(url, "https://api.deepseek.com/models");
      sawAuthHeader = new Headers(init?.headers).get("Authorization");
      return jsonResponse(200, { data: [] });
    },
    () => validateBrainKey("deepseek", Buffer.from("sk-real-key")),
  );

  assert.equal(ok, true);
  assert.equal(sawAuthHeader, "Bearer sk-real-key");
});

test("deepseek: a 403 resolves false", async () => {
  const ok = await withFakeFetch(
    () => jsonResponse(403, { error: { message: "forbidden" } }),
    () => validateBrainKey("deepseek", Buffer.from("sk-bad-key")),
  );
  assert.equal(ok, false);
});
