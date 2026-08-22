#!/usr/bin/env node
// Read-only follow-up to manual-trigger-scheduled-dispatch.mjs: that script's
// own stop condition was wrong (it declared success the moment ANY of
// router_tasks/approval_queue_items/cost_reservations appeared — but a cost
// reservation is written BEFORE the executor call finishes, not after, so it
// stopped mid-flight). This just watches Postgres for the run already
// enqueued to actually finish. Touches no Redis/BullMQ at all.
//
// Usage: node poll-scheduled-dispatch-result.mjs <tenantId> <agentId> <sinceIso>
import { Pool } from "pg";

const [, , tenantId, agentId, sinceIso] = process.argv;
if (!tenantId || !agentId || !sinceIso) {
  console.error("Usage: node poll-scheduled-dispatch-result.mjs <tenantId> <agentId> <sinceIso>");
  process.exitCode = 2;
  process.exit();
}

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required (run this via `railway run`).");

const pool = new Pool({ connectionString: databaseUrl, max: 1 });

async function withTenantScope(fn) {
  const client = await pool.connect();
  let releaseErr;
  try {
    await client.query("BEGIN");
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
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
  const maxAttempts = 40;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const found = await withTenantScope(async (client) => {
      const routerTaskRes = await client.query(
        `SELECT id, status, result, error, approval_action_id, created_at, updated_at FROM router_tasks
         WHERE tenant_id = $1::uuid AND sub_agent_id = $2 AND created_at >= $3 ORDER BY created_at DESC LIMIT 1`,
        [tenantId, agentId, sinceIso],
      );
      const approvalRes = await client.query(
        `SELECT id, kind, task_type, status, payload, verdict, created_at, resolved_at FROM approval_queue_items
         WHERE tenant_id = $1::uuid AND created_at >= $2 ORDER BY created_at DESC LIMIT 1`,
        [tenantId, sinceIso],
      );
      const costRes = await client.query(
        `SELECT id, role_id, task_type, amount_usd, status, created_at, resolved_at FROM cost_reservations
         WHERE tenant_id = $1::uuid AND created_at >= $2 ORDER BY created_at DESC LIMIT 1`,
        [tenantId, sinceIso],
      );
      return { routerTask: routerTaskRes.rows[0] ?? null, approval: approvalRes.rows[0] ?? null, cost: costRes.rows[0] ?? null };
    });

    const terminal = found.routerTask && found.routerTask.status !== "pending" && found.routerTask.status !== "in_progress";
    if (terminal) {
      console.log(`\n--- Run finished (attempt ${attempt}/${maxAttempts}) ---`);
      console.log("router_tasks row:", JSON.stringify(found.routerTask, null, 2));
      console.log("approval_queue_items row:", JSON.stringify(found.approval, null, 2));
      console.log("cost_reservations row:", JSON.stringify(found.cost, null, 2));
      await pool.end();
      return;
    }
    console.log(`Not terminal yet (attempt ${attempt}/${maxAttempts}) — router_tasks status: ${found.routerTask?.status ?? "<no row yet>"}...`);
    await sleep(3000);
  }

  console.error(`::error::router_tasks never reached a terminal status after ${maxAttempts} attempts.`);
  process.exitCode = 1;
  await pool.end();
}

main().catch(async (err) => {
  console.error("Failed:", err.message);
  process.exitCode = 1;
  await pool.end().catch(() => {});
});
