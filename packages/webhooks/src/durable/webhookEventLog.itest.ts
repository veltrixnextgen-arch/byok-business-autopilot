// Integration suite — requires a real, migrated Postgres (DATABASE_URL).
// See packages/db/src/signupExtractionBatches.itest.ts's header for the
// local/CI setup this mirrors.
import { createPool } from "@byok/db";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PostgresWebhookEventLog } from "./webhookEventLog.js";
import type { VerifiedWebhookEvent } from "../types.js";

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

function makeEvent(overrides: Partial<VerifiedWebhookEvent> = {}): VerifiedWebhookEvent {
  return {
    provider: "stripe",
    eventType: "invoice.payment_failed",
    payload: { id: "in_test", nested: { detail: "kept through JSONB round-trip" } },
    receivedAt: new Date().toISOString(),
    ...overrides,
  };
}

test("record persists an event with its JSONB payload intact, readable back", async () => {
  const log = new PostgresWebhookEventLog(pool);
  const tenantId = await seedTenant();
  try {
    await log.record(tenantId, makeEvent());
    const recent = await log.recentForTenant(tenantId);
    assert.equal(recent.length, 1);
    assert.equal(recent[0].eventType, "invoice.payment_failed");
    assert.deepEqual(recent[0].payload, { id: "in_test", nested: { detail: "kept through JSONB round-trip" } });
  } finally {
    await cleanup([tenantId]);
  }
});

test("recentForTenant is newest-first, real Postgres ordering", async () => {
  const log = new PostgresWebhookEventLog(pool);
  const tenantId = await seedTenant();
  try {
    await log.record(tenantId, makeEvent({ eventType: "first" }));
    await new Promise((r) => setTimeout(r, 10));
    await log.record(tenantId, makeEvent({ eventType: "second" }));

    const recent = await log.recentForTenant(tenantId);
    assert.deepEqual(recent.map((e) => e.eventType), ["second", "first"]);
  } finally {
    await cleanup([tenantId]);
  }
});

test("RLS: one tenant's events are invisible to another tenant's scoped session", async () => {
  const log = new PostgresWebhookEventLog(pool);
  const tenantA = await seedTenant();
  const tenantB = await seedTenant();
  try {
    await log.record(tenantA, makeEvent());
    assert.deepEqual(await log.recentForTenant(tenantB), [], "tenant B must not see tenant A's webhook events");
  } finally {
    await cleanup([tenantA, tenantB]);
  }
});
