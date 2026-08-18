import assert from "node:assert/strict";
import { test } from "node:test";
import { trackConnectionHealth } from "./connectionHealth.js";

function immediateReady() {
  return { waitUntilReady: async () => undefined };
}

function neverReady() {
  return { waitUntilReady: () => new Promise(() => {}) };
}

function rejectsWith(message: string) {
  return { waitUntilReady: async () => { throw new Error(message); } };
}

test("starts as 'initializing' synchronously, before waitUntilReady has any chance to resolve", () => {
  const health = trackConnectionHealth(neverReady(), 5000);
  assert.equal(health.status, "initializing");
});

test("flips to 'ready' once the underlying waitUntilReady() resolves", async () => {
  const health = trackConnectionHealth(immediateReady(), 5000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(health.status, "ready");
  assert.equal(typeof health.readyAtMs, "number");
});

test("flips to 'error' (not left stuck at 'initializing') when the connection never becomes ready within the timeout", async () => {
  const health = trackConnectionHealth(neverReady(), 30);
  await new Promise((resolve) => setTimeout(resolve, 60));
  assert.equal(health.status, "error");
  assert.match(health.error ?? "", /did not become ready within 30ms/);
});

test("flips to 'error' immediately when the underlying waitUntilReady() itself rejects, without waiting for the timeout", async () => {
  const health = trackConnectionHealth(rejectsWith("connection refused"), 5000);
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(health.status, "error");
  assert.equal(health.error, "connection refused");
});

test("the returned object is the SAME reference mutated in place -- callers holding an earlier reference see the update, not a stale snapshot", async () => {
  const health = trackConnectionHealth(immediateReady(), 5000);
  const sameReference = health;
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(sameReference.status, "ready");
});
