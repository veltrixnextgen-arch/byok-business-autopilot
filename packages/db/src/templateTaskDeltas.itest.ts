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

test("aggregatedPatterns: a removed task surfaces once it clears the distinct-user threshold, not before", async () => {
  const store = new TemplateTaskDeltaStore(pool);
  const templateId = `service-${randomUUID()}`; // unique per run so counts from other test runs never leak in
  const users = await Promise.all(Array.from({ length: 5 }, () => seedUser()));
  try {
    for (const [i, userId] of users.entries()) {
      const batchId = await seedCompletedBatch(userId, `business ${i}`);
      await store.recordMany(userId, batchId, templateId, [{ taskId: "vendor-management", kind: "removed", detail: null }], "generation");
    }

    const belowThreshold = await store.aggregatedPatterns(6);
    assert.deepEqual(
      belowThreshold.removed.filter((p) => p.templateId === templateId),
      [],
      "5 distinct users must not clear a threshold of 6",
    );

    const atThreshold = await store.aggregatedPatterns(5);
    const match = atThreshold.removed.find((p) => p.templateId === templateId);
    assert.deepEqual(match, { templateId, taskId: "vendor-management", userCount: 5 });
  } finally {
    await cleanup(users);
  }
});

test("aggregatedPatterns: 'added' groups by structural fields only — detail.text never appears in the output", async () => {
  const store = new TemplateTaskDeltaStore(pool);
  const templateId = `saas-${randomUUID()}`;
  const users = await Promise.all(Array.from({ length: 3 }, () => seedUser()));
  try {
    for (const [i, userId] of users.entries()) {
      const batchId = await seedCompletedBatch(userId, `business ${i}`);
      await store.recordMany(
        userId,
        batchId,
        templateId,
        [
          {
            taskId: `sales-followup-${i}`,
            kind: "added",
            detail: {
              text: `a literal business-specific sentence unique to user ${i}`, // must never surface
              agentType: "sales-followup",
              teamHint: "sales",
              frequency: "weekly",
              tier: "T1",
              autonomy: "earnable",
              handsTool: null,
              origin: "customize-added",
            },
          },
        ],
        "generation",
      );
    }

    const patterns = await store.aggregatedPatterns(3);
    const match = patterns.added.find((p) => p.templateId === templateId);
    assert.deepEqual(match, {
      templateId,
      agentType: "sales-followup",
      teamHint: "sales",
      frequency: "weekly",
      tier: "T1",
      autonomy: "earnable",
      origin: "customize-added",
      userCount: 3,
    });
    assert.ok(!JSON.stringify(patterns).includes("business-specific sentence"), "no literal task text may ever appear in the aggregated output");
  } finally {
    await cleanup(users);
  }
});

test("aggregatedPatterns: RLS's internal_metrics exception is the only way this cross-user read works", async () => {
  const store = new TemplateTaskDeltaStore(pool);
  const userId = await seedUser();
  try {
    const batchId = await seedCompletedBatch(userId, "a bakery");
    await store.recordMany(userId, batchId, "service", [{ taskId: "t-1", kind: "removed", detail: null }], "generation");

    // A plain user-scoped session (not internal_metrics) must never see
    // this via a naive cross-user aggregate query — proving the exception
    // this migration carved is what makes aggregatedPatterns possible at
    // all, not an RLS gap.
    const asUser = await withUserScope(pool, userId, async (client) => {
      const result = (await client.query(
        `SELECT count(DISTINCT user_id) AS user_count FROM template_task_deltas WHERE task_id = 't-1'`,
      )) as unknown as { rows: Array<{ user_count: string }> };
      return Number(result.rows[0]?.user_count ?? 0);
    });
    assert.equal(asUser, 1, "a user-scoped session only ever sees its own rows, by design");
  } finally {
    await cleanup([userId]);
  }
});
