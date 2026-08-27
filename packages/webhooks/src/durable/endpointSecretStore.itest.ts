// Integration suite — requires a real, migrated Postgres (DATABASE_URL).
// See packages/db/src/signupExtractionBatches.itest.ts's header for the
// local/CI setup this mirrors.
import { createPool } from "@byok/db";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PostgresWebhookEndpointSecretStore } from "./endpointSecretStore.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required for the integration suite. Start the local stack (`docker compose up -d`), run " +
      "`npm run db:migrate`, then set DATABASE_URL — or run via `npm run test:integration` in CI.",
  );
}

const pool = createPool({ connectionString: DATABASE_URL, max: 20 });

async function seedTenant(): Promise<string> {
  const id = randomUUID();
  await pool.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)", [id, `itest-${id}`, "itest tenant"]);
  return id;
}

async function cleanup(tenantIds: string[]): Promise<void> {
  if (tenantIds.length) await pool.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [tenantIds]);
}

test("set then get round-trips a secret through real Postgres", async () => {
  const store = new PostgresWebhookEndpointSecretStore(pool);
  const tenantId = await seedTenant();
  try {
    await store.set(tenantId, "stripe", "whsec_real_test_123");
    assert.equal(await store.get(tenantId, "stripe"), "whsec_real_test_123");
    assert.equal(await store.isConfigured(tenantId, "stripe"), true);
  } finally {
    await cleanup([tenantId]);
  }
});

test("re-setting replaces the secret (ON CONFLICT DO UPDATE), not a duplicate row", async () => {
  const store = new PostgresWebhookEndpointSecretStore(pool);
  const tenantId = await seedTenant();
  try {
    await store.set(tenantId, "stripe", "whsec_old");
    await store.set(tenantId, "stripe", "whsec_new");
    assert.equal(await store.get(tenantId, "stripe"), "whsec_new");
  } finally {
    await cleanup([tenantId]);
  }
});

// Real RLS proof, not application-code filtering.
test("RLS: one tenant's secret is invisible to another tenant's scoped session", async () => {
  const store = new PostgresWebhookEndpointSecretStore(pool);
  const tenantA = await seedTenant();
  const tenantB = await seedTenant();
  try {
    await store.set(tenantA, "stripe", "whsec_tenant_a_secret");
    assert.equal(await store.get(tenantB, "stripe"), null, "tenant B must not read tenant A's webhook secret");
  } finally {
    await cleanup([tenantA, tenantB]);
  }
});
