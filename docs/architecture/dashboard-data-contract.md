# Dashboard data contract

Phase B's dashboard UI (`roles-and-api-key-guide.md` Screen 16: "cost and
activity per role and per sub-agent") reads from `apps/router/src/durable/queries.ts`'s
`CostActivityQueries` interface, implemented by `PostgresCostActivityQueries`.
This is a pure read layer over the durable-storage tables in
`packages/db/src/migrations/0002_durable_storage.sql` — nothing here writes
anything, and it never bypasses RLS (every method runs inside
`withTenantScope`, so a caller only ever sees its own tenant's data).

## Terminology note

The router's `RouterTask` has both `teamId` and `subAgentId`. The cost
gate only knows `roleId`/`taskType` — `router.ts`'s `submitTask()` calls
the gate with `roleId: task.teamId, taskType: task.subAgentId`. So in
`cost_reservations`, `role_id` **is** the router's `teamId` and
`task_type` **is** the router's `subAgentId`. That means "spend by
sub-agent" and "spend by task type" are the same query
(`spendByTaskType`) — there's no separate sub-agent column to group by
beyond that. This is pre-existing router/cost-gate naming, not something
introduced by the dashboard work.

## Methods

### `spendByRole(tenantId, since?)` → `{ key: string; totalUsd: number }[]`

Total spend (`status IN ('reserved', 'settled')` — in-flight counts too,
same as the ceiling checks) grouped by role (`teamId`), optionally since a
given date. Sorted highest spend first.

### `spendByTaskType(tenantId, since?)` → `{ key: string; totalUsd: number }[]`

Same as above, grouped by task type (`subAgentId`).

### `autonomyStatus(tenantId)` → `{ taskType: string; active: boolean; consecutiveApprovals: number }[]`

One row per task type this tenant has any autonomy history for — whether
earned autonomy is currently active, and the running consecutive-approval
count toward the next offer.

### `recentActivity(tenantId, limit = 50)` → `StoredAuditEvent[]`

The unified `audit_log` table (see `packages/db/src/durableAuditLog.ts`),
newest first: gate verdicts (`reserved`, etc.) and queue events (`queued`,
`APPROVE`, `REJECT`, `MODIFY`, `recommendation-submitted`,
`recommendation-resolved`), each tagged with `source` and an optional
`detail` payload.

## What's out of scope here

**2026-08-08 (Phase 1C):** `GET /dashboard` (`apps/api/src/routes/dashboard.ts`)
now exposes a slice of this — `spendByRole` (all-time and today) and
`recentActivity` — as a pure read pass-through, tenant-scoped the same way
every other route is (`tenantMiddleware` + `c.get("tenantId")`, never a
client-supplied value). It's deliberately partial: `spendByTaskType` and
`autonomyStatus` still have no route, and there is still no
"skip-the-call" suggestion engine — apps/web's dashboard shows an honest
empty state for anything this route doesn't cover, rather than inventing
data. The full Screen 16 layout (payroll report, per-sub-agent view) is
still later work.
