#!/usr/bin/env node
// One-shot (no loop) read of the current state of a specific manually
// triggered run — companion to poll-scheduled-dispatch-result.mjs, for
// checking in on a run that's already been waited on once.
//
// Usage: node check-scheduled-dispatch-result.mjs <tenantId> <agentId> <sinceIso>
import { Pool } from "pg";

const [, , tenantId, agentId, sinceIso] = process.argv;
if (!tenantId || !agentId || !sinceIso) {
  console.error("Usage: node check-scheduled-dispatch-result.mjs <tenantId> <agentId> <sinceIso>");
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

async function main() {
  const found = await withTenantScope(async (client) => {
    const approvalRes = await client.query(
      `SELECT id, kind, task_type, status, payload, verdict, created_at, resolved_at FROM approval_queue_items
       WHERE tenant_id = $1::uuid AND created_at >= $2 ORDER BY created_at DESC LIMIT 3`,
      [tenantId, sinceIso],
    );
    const costRes = await client.query(
      `SELECT id, role_id, task_type, amount_usd, status, created_at, resolved_at FROM cost_reservations
       WHERE tenant_id = $1::uuid AND created_at >= $2 ORDER BY created_at DESC LIMIT 3`,
      [tenantId, sinceIso],
    );
    const auditRes = await client.query(
      `SELECT id, source, kind, ref_id, detail, at FROM audit_log
       WHERE tenant_id = $1::uuid AND at >= $2 ORDER BY at DESC LIMIT 10`,
      [tenantId, sinceIso],
    );
    return { approvals: approvalRes.rows, costs: costRes.rows, audit: auditRes.rows };
  });

  console.log("approval_queue_items (most recent 3):", JSON.stringify(found.approvals, null, 2));
  console.log("cost_reservations (most recent 3):", JSON.stringify(found.costs, null, 2));
  console.log("audit_log (most recent 10):", JSON.stringify(found.audit, null, 2));
  await pool.end();
}

main().catch(async (err) => {
  console.error("Failed:", err.message);
  process.exitCode = 1;
  await pool.end().catch(() => {});
});
