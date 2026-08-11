// Integration suite — requires a real, migrated Postgres (DATABASE_URL).
// Run via `npm run test:integration` (packages/db), never as part of the
// regular `npm test`. Locally: `docker compose up -d` then
// `npm run db:migrate` from repo root. In CI: a Postgres service
// container, migrated before this runs — see .github/workflows/ci.yml.
//
// Covers issue #38 (the org-chart -> tenant handoff, ADR-015's deferred
// gap): claimLatestForTenant's own logic is exercised elsewhere only via
// mocks (apps/api's routes/tests), which can't prove the thing that
// actually matters here — that Postgres itself, not application code,
// is what makes a claimed row invisible to its original owner and a
// tenant's own claim invisible to every other tenant.
import { createPool } from "./connection.js";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { SignupExtractionBatchStore } from "./signupExtractionBatches.js";
import { withUserScope } from "./userContext.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required for the integration suite. Start the local stack (`docker compose up -d`), run " +
      "`npm run db:migrate`, then set DATABASE_URL — or run via `npm run test:integration` in CI, where the " +
      "workflow migrates a Postgres service container before this runs.",
  );
}

const pool = createPool({ connectionString: DATABASE_URL, max: 20 });

async function seedUser(): Promise<string> {
  const id = randomUUID();
  await pool.query("INSERT INTO users (id, email) VALUES ($1, $2)", [id, `itest-${id}@example.invalid`]);
  return id;
}

async function seedTenant(): Promise<string> {
  const id = randomUUID();
  await pool.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)", [id, `itest-${id}`, "itest tenant"]);
  return id;
}

async function seedCompletedBatch(store: SignupExtractionBatchStore, userId: string, idea: string): Promise<string> {
  const batch = await store.start(userId, idea);
  await store.complete(userId, batch.id, { meta: { idea } } as never, 0.03);
  return batch.id;
}

async function cleanup(userIds: string[], tenantIds: string[]): Promise<void> {
  if (userIds.length) await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
  if (tenantIds.length) await pool.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [tenantIds]);
}

test("claim happy path: a completed batch becomes readable by tenantId, no longer by userId", async () => {
  const store = new SignupExtractionBatchStore(pool);
  const userId = await seedUser();
  const tenantId = await seedTenant();
  try {
    const batchId = await seedCompletedBatch(store, userId, "a barber shop");

    const claimed = await store.claimLatestForTenant(userId, tenantId);
    assert.equal(claimed?.id, batchId);
    assert.equal(claimed?.tenantId, tenantId);

    const viaTenant = await store.latestForTenant(tenantId);
    assert.equal(viaTenant?.id, batchId, "the tenant must be able to read its own claimed chart");

    const viaOldUserSession = await store.get(userId, batchId);
    assert.equal(viaOldUserSession, null, "the pre-transfer user_id path must be closed once a row is claimed");
  } finally {
    await cleanup([userId], [tenantId]);
  }
});

test("idempotent: claiming twice for the same tenant returns the same batch, never throws, never double-claims", async () => {
  const store = new SignupExtractionBatchStore(pool);
  const userId = await seedUser();
  const tenantId = await seedTenant();
  try {
    const batchId = await seedCompletedBatch(store, userId, "a bakery");

    const first = await store.claimLatestForTenant(userId, tenantId);
    const second = await store.claimLatestForTenant(userId, tenantId);

    assert.equal(first?.id, batchId);
    assert.equal(second?.id, batchId);
  } finally {
    await cleanup([userId], [tenantId]);
  }
});

test("nothing to claim (no completed batch yet) is a clean null, not an error", async () => {
  const store = new SignupExtractionBatchStore(pool);
  const userId = await seedUser();
  const tenantId = await seedTenant();
  try {
    const result = await store.claimLatestForTenant(userId, tenantId);
    assert.equal(result, null);
  } finally {
    await cleanup([userId], [tenantId]);
  }
});

// Issue #38's explicit ask: "a user with multiple pre-org extractions...
// must not end up with orphaned or cross-claimed records."
test("multiple pre-org extractions: only the latest completed batch is claimed, the older one is untouched, not orphaned", async () => {
  const store = new SignupExtractionBatchStore(pool);
  const userId = await seedUser();
  const tenantId = await seedTenant();
  try {
    const olderBatchId = await seedCompletedBatch(store, userId, "idea one");
    // Ensure a distinct, later created_at than the first insert.
    await new Promise((r) => setTimeout(r, 10));
    const newerBatchId = await seedCompletedBatch(store, userId, "idea two");

    const claimed = await store.claimLatestForTenant(userId, tenantId);
    assert.equal(claimed?.id, newerBatchId, "the most recent completed batch is the one that gets claimed");

    const olderStillOwnedByUser = await store.get(userId, olderBatchId);
    assert.ok(olderStillOwnedByUser, "the older batch must still exist and remain readable by its original owner");
    assert.equal(olderStillOwnedByUser?.tenantId, null, "the older batch must never be silently claimed too");
  } finally {
    await cleanup([userId], [tenantId]);
  }
});

// "...or who abandons and returns" — no special time-based logic exists
// (or should exist) for this; claiming must work identically regardless
// of how long a completed batch has sat unclaimed.
test("abandon and return: a batch completed long before org creation still claims correctly", async () => {
  const store = new SignupExtractionBatchStore(pool);
  const userId = await seedUser();
  const tenantId = await seedTenant();
  try {
    const batchId = await seedCompletedBatch(store, userId, "an idea from a while ago");
    await withUserScope(pool, userId, (client) =>
      client.query(`UPDATE signup_extraction_batches SET created_at = now() - interval '30 days' WHERE id = $1::uuid`, [batchId]),
    );

    const claimed = await store.claimLatestForTenant(userId, tenantId);
    assert.equal(claimed?.id, batchId);
  } finally {
    await cleanup([userId], [tenantId]);
  }
});

// The explicit requirement: "Test that a transferred chart can't be read
// by another tenant." Real RLS proof, not application-code filtering —
// tenantB's own scoped session, not a mocked check.
test("RLS: a transferred chart cannot be read by another tenant", async () => {
  const store = new SignupExtractionBatchStore(pool);
  const userId = await seedUser();
  const tenantA = await seedTenant();
  const tenantB = await seedTenant();
  try {
    const batchId = await seedCompletedBatch(store, userId, "a coffee shop");
    await store.claimLatestForTenant(userId, tenantA);

    const asTenantB = await store.getForTenant(tenantB, batchId);
    assert.equal(asTenantB, null, "tenant B must not be able to read tenant A's claimed chart by id");

    const latestForTenantB = await store.latestForTenant(tenantB);
    assert.equal(latestForTenantB, null, "tenant B's own latest-chart read must not surface tenant A's chart");
  } finally {
    await cleanup([userId], [tenantA, tenantB]);
  }
});

test("a second tenant claiming (a different user's) batch cannot cross-claim an already-claimed row", async () => {
  const store = new SignupExtractionBatchStore(pool);
  const userA = await seedUser();
  const userB = await seedUser();
  const tenantA = await seedTenant();
  const tenantB = await seedTenant();
  try {
    const batchA = await seedCompletedBatch(store, userA, "user A's idea");
    await seedCompletedBatch(store, userB, "user B's idea");

    await store.claimLatestForTenant(userA, tenantA);
    const claimedForB = await store.claimLatestForTenant(userB, tenantB);

    // tenant B claims userB's own batch, never userA's — cross-claiming
    // would mean tenant B ending up with batchA's id, which must never
    // happen since claimLatestForTenant only ever looks at the given
    // userId's own unclaimed rows.
    assert.notEqual(claimedForB?.id, batchA);

    const batchAOwner = await store.getForTenant(tenantA, batchA);
    assert.equal(batchAOwner?.tenantId, tenantA, "tenant A's claim on its own batch must be undisturbed");
  } finally {
    await cleanup([userA, userB], [tenantA, tenantB]);
  }
});
