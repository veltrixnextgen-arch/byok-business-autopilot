import { test } from "node:test";
import assert from "node:assert/strict";
import Stripe from "stripe";
import { verifyWebhookSignature } from "./verification.js";
import { UnknownWebhookProviderError, WebhookSignatureError } from "./types.js";

const SECRET = "whsec_test_secret_1234567890";
const PAYLOAD = JSON.stringify({
  id: "evt_test123",
  object: "event",
  type: "invoice.payment_failed",
  data: { object: { id: "in_test123", object: "invoice", status: "open" } },
});

function realStripeSignature(payload: string, secret: string): string {
  // Real Stripe signature generation, not a hand-rolled HMAC — proves
  // verifyWebhookSignature actually interoperates with Stripe's own
  // signing scheme, not just a mock of it. This is the one module in
  // this package where testing against the real crypto matters most
  // (R6's own build-order entry: "highest value, highest security
  // surface").
  return Stripe.webhooks.generateTestHeaderString({ payload, secret });
}

test("a genuinely valid Stripe signature verifies, and the event is normalized correctly", () => {
  const signature = realStripeSignature(PAYLOAD, SECRET);
  const result = verifyWebhookSignature("stripe", PAYLOAD, signature, SECRET);

  assert.equal(result.provider, "stripe");
  assert.equal(result.eventType, "invoice.payment_failed");
  assert.deepEqual(result.payload, { id: "in_test123", object: "invoice", status: "open" });
  assert.ok(result.receivedAt);
});

test("a signature generated with the WRONG secret is rejected", () => {
  const signature = realStripeSignature(PAYLOAD, "whsec_a_completely_different_secret");
  assert.throws(() => verifyWebhookSignature("stripe", PAYLOAD, signature, SECRET), WebhookSignatureError);
});

test("a tampered payload (valid signature for different bytes) is rejected", () => {
  const signature = realStripeSignature(PAYLOAD, SECRET);
  const tampered = PAYLOAD.replace("invoice.payment_failed", "invoice.payment_succeeded");
  assert.throws(() => verifyWebhookSignature("stripe", tampered, signature, SECRET), WebhookSignatureError);
});

test("a missing signature header is rejected before any verification runs", () => {
  assert.throws(() => verifyWebhookSignature("stripe", PAYLOAD, undefined, SECRET), WebhookSignatureError);
});

test("an unrecognized provider throws UnknownWebhookProviderError, never silently skips verification", () => {
  assert.throws(
    () => verifyWebhookSignature("carrier-pigeon" as never, PAYLOAD, "some-signature", SECRET),
    UnknownWebhookProviderError,
  );
});
