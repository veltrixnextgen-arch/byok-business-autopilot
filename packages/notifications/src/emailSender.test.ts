import assert from "node:assert/strict";
import { test } from "node:test";
import { createEmailSender, LoggingEmailSender, ResendEmailSender } from "./emailSender.js";

test("createEmailSender falls back to LoggingEmailSender when no API key is configured", () => {
  const sender = createEmailSender({ fromAddress: "test@example.com" });
  assert.ok(sender instanceof LoggingEmailSender);
});

test("createEmailSender returns a real ResendEmailSender when an API key is configured", () => {
  const sender = createEmailSender({ resendApiKey: "re_test_key", fromAddress: "test@example.com" });
  assert.ok(sender instanceof ResendEmailSender);
});

// The whole reason LoggingEmailSender exists (issue #140): a misconfigured
// deploy must be loud, not silently do nothing.
test("LoggingEmailSender never throws, but does log every attempted send", async () => {
  const originalError = console.error;
  const logs: unknown[][] = [];
  console.error = (...args: unknown[]) => logs.push(args);
  try {
    const sender = new LoggingEmailSender();
    await sender.send({ to: "owner@example.com", subject: "Your automation has paused", text: "..." });
  } finally {
    console.error = originalError;
  }
  assert.equal(logs.length, 1);
  assert.match(String(logs[0][0]), /owner@example\.com/);
  assert.match(String(logs[0][0]), /Your automation has paused/);
});

test("ResendEmailSender posts to Resend's API with the right shape and throws on a non-ok response", async () => {
  const originalFetch = globalThis.fetch;
  const calls: Array<{ url: string; init: RequestInit }> = [];
  globalThis.fetch = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return new Response("bad request", { status: 400 });
  }) as typeof fetch;

  try {
    const sender = new ResendEmailSender("re_test_key", "notifications@example.com");
    await assert.rejects(
      () => sender.send({ to: "owner@example.com", subject: "Subject", text: "Body" }),
      /Resend API returned 400/,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(calls.length, 1);
  assert.equal(calls[0]!.url, "https://api.resend.com/emails");
  assert.equal((calls[0]!.init.headers as Record<string, string>).Authorization, "Bearer re_test_key");
  const body = JSON.parse(calls[0]!.init.body as string);
  assert.deepEqual(body, { from: "notifications@example.com", to: "owner@example.com", subject: "Subject", text: "Body" });
});

test("ResendEmailSender resolves cleanly on a successful send", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => new Response(JSON.stringify({ id: "email-1" }), { status: 200 })) as typeof fetch;
  try {
    const sender = new ResendEmailSender("re_test_key", "notifications@example.com");
    await sender.send({ to: "owner@example.com", subject: "Subject", text: "Body" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});
