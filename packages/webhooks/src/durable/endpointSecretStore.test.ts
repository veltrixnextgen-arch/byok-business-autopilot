import { test } from "node:test";
import assert from "node:assert/strict";
import { InMemoryWebhookEndpointSecretStore } from "./endpointSecretStore.js";

test("set then get round-trips the secret exactly", async () => {
  const store = new InMemoryWebhookEndpointSecretStore();
  await store.set("tenant-1", "stripe", "whsec_abc123");
  assert.equal(await store.get("tenant-1", "stripe"), "whsec_abc123");
});

test("get returns null when nothing is configured", async () => {
  const store = new InMemoryWebhookEndpointSecretStore();
  assert.equal(await store.get("tenant-1", "stripe"), null);
});

test("isConfigured reflects whether a secret exists, without ever returning the value itself", async () => {
  const store = new InMemoryWebhookEndpointSecretStore();
  assert.equal(await store.isConfigured("tenant-1", "stripe"), false);
  await store.set("tenant-1", "stripe", "whsec_abc123");
  assert.equal(await store.isConfigured("tenant-1", "stripe"), true);
});

test("secrets are isolated per tenant", async () => {
  const store = new InMemoryWebhookEndpointSecretStore();
  await store.set("tenant-a", "stripe", "whsec_a");
  await store.set("tenant-b", "stripe", "whsec_b");

  assert.equal(await store.get("tenant-a", "stripe"), "whsec_a");
  assert.equal(await store.get("tenant-b", "stripe"), "whsec_b");
});

test("re-setting a secret for the same (tenant, provider) replaces the old one", async () => {
  const store = new InMemoryWebhookEndpointSecretStore();
  await store.set("tenant-1", "stripe", "whsec_old");
  await store.set("tenant-1", "stripe", "whsec_new");
  assert.equal(await store.get("tenant-1", "stripe"), "whsec_new");
});
