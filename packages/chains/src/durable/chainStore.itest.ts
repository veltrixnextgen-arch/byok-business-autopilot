// Integration suite — requires a real, migrated Postgres (DATABASE_URL).
// Run via `npm run test:integration` (packages/chains). See
// packages/db/src/signupExtractionBatches.itest.ts's header for the
// local/CI setup this mirrors exactly.
import { createPool } from "@byok/db";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { PostgresChainStore, UnknownChainError } from "./chainStore.js";
import type { Chain, ChainStep } from "../types.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required for the integration suite. Start the local stack (`docker compose up -d`), run " +
      "`npm run db:migrate`, then set DATABASE_URL — or run via `npm run test:integration` in CI, where the " +
      "workflow migrates a Postgres service container before this runs.",
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

function makeStep(id: string): ChainStep {
  return { id, agentId: "agent-1", subAgentId: "invoicing", description: "a step", requiresApproval: false, status: "pending" };
}

function newChainInput(tenantId: string): Omit<Chain, "id"> {
  const now = new Date().toISOString();
  return {
    tenantId,
    triggerSummary: "Overdue invoice detected for Acme Corp",
    steps: [makeStep("step-1"), makeStep("step-2")],
    currentStepIndex: 0,
    status: "running",
    createdAt: now,
    updatedAt: now,
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  };
}

test("create persists a chain with its JSONB steps intact, readable back via get", async () => {
  const store = new PostgresChainStore(pool);
  const tenantId = await seedTenant();
  try {
    const created = await store.create(newChainInput(tenantId));
    assert.ok(created.id);

    const fetched = await store.get(tenantId, created.id);
    assert.deepEqual(fetched?.steps, created.steps);
    assert.equal(fetched?.status, "running");
  } finally {
    await cleanup([tenantId]);
  }
});

test("save performs a real whole-object read-modify-write against Postgres", async () => {
  const store = new PostgresChainStore(pool);
  const tenantId = await seedTenant();
  try {
    const created = await store.create(newChainInput(tenantId));

    const advanced: Chain = {
      ...created,
      status: "awaiting_approval",
      steps: created.steps.map((s, i) => (i === 0 ? { ...s, status: "completed" as const } : s)),
      updatedAt: new Date().toISOString(),
    };
    await store.save(advanced);

    const fetched = await store.get(tenantId, created.id);
    assert.equal(fetched?.status, "awaiting_approval");
    assert.equal(fetched?.steps[0].status, "completed");
  } finally {
    await cleanup([tenantId]);
  }
});

test("save throws UnknownChainError for a chain id that doesn't exist in this tenant's row set", async () => {
  const store = new PostgresChainStore(pool);
  const tenantId = await seedTenant();
  try {
    const fake: Chain = { ...newChainInput(tenantId), id: randomUUID() };
    await assert.rejects(() => store.save(fake), UnknownChainError);
  } finally {
    await cleanup([tenantId]);
  }
});

// Real RLS proof, not application-code filtering — a second tenant's own
// scoped session, matching every other durable store's own isolation
// test this session (e.g. signupExtractionBatches.itest.ts).
test("RLS: one tenant's chains are invisible to another tenant's scoped session", async () => {
  const store = new PostgresChainStore(pool);
  const tenantA = await seedTenant();
  const tenantB = await seedTenant();
  try {
    const created = await store.create(newChainInput(tenantA));

    assert.equal(await store.get(tenantB, created.id), null, "tenant B must not be able to read tenant A's chain by id");
    assert.deepEqual(await store.listByTenant(tenantB), [], "tenant B's own listing must not surface tenant A's chains");
  } finally {
    await cleanup([tenantA, tenantB]);
  }
});

test("listByTenant returns only that tenant's chains, newest first", async () => {
  const store = new PostgresChainStore(pool);
  const tenantId = await seedTenant();
  try {
    const first = await store.create(newChainInput(tenantId));
    await new Promise((r) => setTimeout(r, 10));
    const second = await store.create(newChainInput(tenantId));

    const chains = await store.listByTenant(tenantId);
    assert.equal(chains.length, 2);
    assert.equal(chains[0].id, second.id);
    assert.equal(chains[1].id, first.id);
  } finally {
    await cleanup([tenantId]);
  }
});
