#!/usr/bin/env node
// Ops-only, one-off diagnostic: fires exactly ONE real scheduled-dispatch
// job for a named tenant, through the exact same BullMQ queue/job name/
// payload shape the recurring scheduler itself uses (packages/jobs's
// tenantScheduler.ts + apps/api's computeDesiredSchedule.ts +
// scheduledDispatchProcessor.ts) — nothing mocked, nothing bypassed.
//
// This script exists ONLY because there is currently no safe, product-
// level "run now" path anywhere in the app (confirmed: no route, no admin
// UI, no CLI — see the issue filed alongside this script). It is not a
// feature; it's the manual substitute for one, used exactly once to
// obtain real, fresh evidence of what a scheduled dispatch actually
// produces. It must be run with `railway run` (or equivalent) so
// DATABASE_URL/REDIS_URL come from the real environment and are never
// typed, echoed, or logged by this script.
//
// Usage: node manual-trigger-scheduled-dispatch.mjs "<tenant name or slug substring>"
//
// What it does, in order:
//   1. Looks up the tenant by name/slug (case-insensitive substring).
//   2. Refuses to proceed if the tenant's schedule is currently paused —
//      a manual trigger overriding a real pause (e.g. ceiling-exhausted)
//      would misrepresent what the product would actually do right now.
//   3. Reads the tenant's active Charter + claimed org chart, and picks
//      the first task with triggerType "cadence" and an owning agent —
//      the same selection a real cadence tick would dispatch.
//   4. Enqueues exactly one job via queue.add (NOT upsertJobScheduler —
//      this must never create or touch a recurring schedule).
//   5. Polls router_tasks / approval_queue_items / cost_reservations for
//      the new row(s) the real worker process writes, and prints them.
import { Pool } from "pg";
import { Queue } from "bullmq";

const [, , tenantQuery] = process.argv;
if (!tenantQuery) {
  console.error('Usage: node manual-trigger-scheduled-dispatch.mjs "<tenant name or slug substring>"');
  process.exitCode = 2;
  process.exit();
}

const databaseUrl = process.env.DATABASE_URL;
const redisUrl = process.env.REDIS_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required (run this via `railway run`).");
if (!redisUrl) throw new Error("REDIS_URL is required (run this via `railway run`).");

const pool = new Pool({ connectionString: databaseUrl, max: 3 });

async function withTenantScope(tenantId, fn) {
  const client = await pool.connect();
  let releaseErr;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
    // packages/db/src/tenantContext.ts's withTenantScope explicitly clears
    // every OTHER app.* scope var too (issue #38) — a pooled Postgres
    // connection's custom GUCs can stick at a stale value from a prior,
    // unrelated transaction, and an empty-string leftover on app.user_id
    // throws exactly "invalid input syntax for type uuid: \"\"" the moment
    // any RLS policy tries to cast it. Mirrored here for the same reason.
    await client.query("SELECT set_config('app.user_id', $1, true)", ["00000000-0000-0000-0000-000000000000"]);
    await client.query("SELECT set_config('app.internal_metrics', 'false', true)");
    const result = await fn(client);
    await client.query("COMMIT");
    return result;
  } catch (err) {
    releaseErr = err;
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally {
    client.release(releaseErr);
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function main() {
  const tenantRes = await pool.query(
    `SELECT id, slug, name FROM tenants WHERE name ILIKE $1 OR slug ILIKE $1 ORDER BY created_at ASC LIMIT 2`,
    [`%${tenantQuery}%`],
  );
  if (tenantRes.rows.length === 0) throw new Error(`No tenant matching "${tenantQuery}".`);
  if (tenantRes.rows.length > 1) {
    throw new Error(
      `Ambiguous: multiple tenants match "${tenantQuery}": ${tenantRes.rows.map((r) => `${r.name} (${r.id})`).join(", ")}`,
    );
  }
  const tenant = tenantRes.rows[0];
  console.log(`Tenant: ${tenant.name} (${tenant.id})`);

  const { schedule, charter, batch } = await withTenantScope(tenant.id, async (client) => {
    const scheduleRes = await client.query(`SELECT paused_at, paused_reason FROM tenant_schedule_state WHERE tenant_id = $1::uuid`, [tenant.id]);
    const charterRes = await client.query(
      `SELECT id, cascade FROM company_charters WHERE tenant_id = $1::uuid AND status = 'active' LIMIT 1`,
      [tenant.id],
    );
    const batchRes = await client.query(
      `SELECT id, org_chart FROM signup_extraction_batches WHERE tenant_id = $1::uuid ORDER BY created_at DESC LIMIT 1`,
      [tenant.id],
    );
    return { schedule: scheduleRes.rows[0] ?? null, charter: charterRes.rows[0] ?? null, batch: batchRes.rows[0] ?? null };
  });

  if (schedule?.paused_at) {
    throw new Error(
      `Refusing to trigger: tenant's schedule is currently paused (reason: ${schedule.paused_reason}). ` +
        `A manual trigger would misrepresent what the product would actually do right now.`,
    );
  }
  if (!charter?.cascade) throw new Error("Tenant has no active Charter with an installed cascade.");
  if (!batch?.org_chart) throw new Error("Tenant has no claimed org chart.");

  const chart = batch.org_chart;
  const agentByTaskId = new Map();
  for (const agent of chart.agents) {
    for (const taskId of agent.taskIds) agentByTaskId.set(taskId, agent);
  }
  const task = chart.tasks.find((t) => t.triggerType === "cadence" && agentByTaskId.has(t.id));
  if (!task) throw new Error("No cadence-triggered task with an owning agent found in this tenant's org chart.");
  const agent = agentByTaskId.get(task.id);

  console.log(`Selected: agent "${agent.name}" (${agent.id}), task "${task.text}" (${task.id})`);

  const sinceIso = new Date().toISOString();

  const queue = new Queue("scheduled-dispatch", { connection: { url: redisUrl, commandTimeout: 10_000 } });
  console.log("Enqueuing one-off job onto the real \"scheduled-dispatch\" queue (queue.add, not upsertJobScheduler)...");
  await queue.add("scheduled-dispatch", { tenantId: tenant.id, agentId: agent.id, taskId: task.id });
  await queue.close();
  console.log(`Enqueued at ${sinceIso}. Polling for the real worker to process it...`);

  const maxAttempts = 30;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const found = await withTenantScope(tenant.id, async (client) => {
      const routerTaskRes = await client.query(
        `SELECT id, status, result, error, created_at FROM router_tasks
         WHERE tenant_id = $1::uuid AND sub_agent_id = $2 AND created_at >= $3 ORDER BY created_at DESC LIMIT 1`,
        [tenant.id, agent.id, sinceIso],
      );
      const approvalRes = await client.query(
        `SELECT id, kind, task_type, status, payload, created_at FROM approval_queue_items
         WHERE tenant_id = $1::uuid AND created_at >= $2 ORDER BY created_at DESC LIMIT 1`,
        [tenant.id, sinceIso],
      );
      const costRes = await client.query(
        `SELECT id, role_id, task_type, amount_usd, status, created_at FROM cost_reservations
         WHERE tenant_id = $1::uuid AND created_at >= $2 ORDER BY created_at DESC LIMIT 1`,
        [tenant.id, sinceIso],
      );
      return { routerTask: routerTaskRes.rows[0] ?? null, approval: approvalRes.rows[0] ?? null, cost: costRes.rows[0] ?? null };
    });

    if (found.routerTask || found.approval || found.cost) {
      console.log(`\n--- Dispatch observed (attempt ${attempt}/${maxAttempts}) ---`);
      console.log("router_tasks row:", JSON.stringify(found.routerTask, null, 2));
      console.log("approval_queue_items row:", JSON.stringify(found.approval, null, 2));
      console.log("cost_reservations row:", JSON.stringify(found.cost, null, 2));
      await pool.end();
      return;
    }
    console.log(`Nothing yet (attempt ${attempt}/${maxAttempts})...`);
    await sleep(3000);
  }

  console.error(`::error::No router_tasks/approval_queue_items/cost_reservations row appeared for tenant ${tenant.id} after ${maxAttempts} attempts.`);
  process.exitCode = 1;
  await pool.end();
}

main().catch(async (err) => {
  console.error("Failed:", err.message);
  process.exitCode = 1;
  await pool.end().catch(() => {});
});
