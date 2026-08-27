// Integration suite — requires a real, migrated Postgres (DATABASE_URL).
// Run via `npm run test:integration` (packages/db). See
// signupExtractionBatches.itest.ts's header for the local/CI setup.
//
// Covers the template-learning capture layer (docs/STATUS.md) — proves
// recordMany actually persists rows through RLS (not just that the SQL
// is well-formed against a mock), and that isolation is real Postgres
// enforcement, not application-code filtering, matching this table's
// user-scoped policy (migrations/0016_template_task_deltas.sql).
import { createPool } from "./connection.js";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { SignupExtractionBatchStore } from "./signupExtractionBatches.js";
import { TemplateTaskDeltaStore } from "./templateTaskDeltas.js";
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

async function seedCompletedBatch(userId: string, idea: string): Promise<string> {
  const batchStore = new SignupExtractionBatchStore(pool);
  const batch = await batchStore.start(userId, idea);
  await batchStore.complete(userId, batch.id, { meta: { idea } } as never, 0.03);
  return batch.id;
}

async function deltaRowsFor(userId: string, batchId: string) {
  return withUserScope(pool, userId, async (client) => {
    const result = (await client.query(
      "SELECT task_id, delta_kind, detail, source FROM template_task_deltas WHERE batch_id = $1::uuid ORDER BY task_id",
      [batchId],
    )) as unknown as { rows: Array<{ task_id: string; delta_kind: string; detail: unknown; source: string }> };
    return result.rows;
  });
}

async function cleanup(userIds: string[]): Promise<void> {
  if (userIds.length) await pool.query("DELETE FROM users WHERE id = ANY($1::uuid[])", [userIds]);
}

test("recordMany persists every delta, readable back by its owning user", async () => {
  const store = new TemplateTaskDeltaStore(pool);
  const userId = await seedUser();
  try {
    const batchId = await seedCompletedBatch(userId, "a bakery");

    await store.recordMany(
      userId,
      batchId,
      "service",
      [
        { taskId: "t-added", kind: "added", detail: { text: "new task" } },
        { taskId: "t-removed", kind: "removed", detail: null },
        { taskId: "t-freq", kind: "frequency_changed", detail: { from: "weekly", to: "daily" } },
      ],
      "generation",
    );

    const rows = await deltaRowsFor(userId, batchId);
    assert.equal(rows.length, 3);
    assert.deepEqual(
      rows.map((r) => r.task_id),
      ["t-added", "t-freq", "t-removed"],
    );
    assert.ok(rows.every((r) => r.source === "generation"));
    const added = rows.find((r) => r.task_id === "t-added");
    assert.deepEqual(added?.detail, { text: "new task" });
  } finally {
    await cleanup([userId]);
  }
});

test("recordMany with an empty delta list is a clean no-op", async () => {
  const store = new TemplateTaskDeltaStore(pool);
  const userId = await seedUser();
  try {
    const batchId = await seedCompletedBatch(userId, "a laundromat");
    await store.recordMany(userId, batchId, "service", [], "reassemble");
    const rows = await deltaRowsFor(userId, batchId);
    assert.deepEqual(rows, []);
  } finally {
    await cleanup([userId]);
  }
});

test("RLS: one user's deltas are invisible to another user's scoped session", async () => {
  const store = new TemplateTaskDeltaStore(pool);
  const userA = await seedUser();
  const userB = await seedUser();
  try {
    const batchId = await seedCompletedBatch(userA, "user A's idea");
    await store.recordMany(userA, batchId, "service", [{ taskId: "t-1", kind: "added", detail: null }], "generation");

    const asUserB = await deltaRowsFor(userB, batchId);
    assert.deepEqual(asUserB, [], "user B must not see user A's template-learning deltas");
  } finally {
    await cleanup([userA, userB]);
  }
});
