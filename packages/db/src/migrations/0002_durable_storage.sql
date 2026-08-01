-- Durable storage for trust-core (issue #6): cost ledger, dedup keys,
-- the router's per-sub-agent ledger, approval-queue items + verdicts,
-- autonomy counters, paused-batch state, and a unified audit log.
--
-- Every table here follows the 0001_init.sql RLS pattern exactly:
-- ENABLE + FORCE ROW LEVEL SECURITY, one FOR ALL policy comparing
-- tenant_id against current_setting('app.tenant_id', true)::uuid. See
-- 0001_init.sql's header for why FORCE matters and what it does not cover
-- (superusers / BYPASSRLS roles).
--
-- AMOUNTS: cost figures use NUMERIC(14,6) — dollars with six decimal
-- places, matching the pricing/estimator code's existing float precision
-- (per-token pricing produces sub-cent, sub-mill figures) — not integer
-- cents, which would lose that precision or require an awkward
-- micro-cents convention.
--
-- AUDIT LOG: one unified, append-only table with a `source` column
-- (cost-gate | approval-queue) rather than per-source tables. All three
-- in-memory audit logs (packages/vault, packages/cost-gate,
-- packages/approval-queue) share the same shape — id, timestamp, a
-- handful of scalar fields, one optional free-text detail — and the
-- dashboard's "recent activity" view (item d) wants to query across all
-- of them for a tenant in one place. A `detail` JSONB column carries the
-- source-specific fields (verdict/model for cost-gate; kind/feedback for
-- approval-queue) rather than a wide table of mostly-null columns.
-- packages/vault's audit log is NOT included here: it's Brain/Hands key
-- lifecycle, deliberately scoped to the vault's own key material and kept
-- separate from tenant-facing spend/activity data.

CREATE TABLE IF NOT EXISTS cost_ledger_counters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  level TEXT NOT NULL CHECK (level IN ('company', 'role', 'task-type')),
  scope_key TEXT NOT NULL,
  total_usd NUMERIC(14, 6) NOT NULL DEFAULT 0,
  ceiling_usd NUMERIC(14, 6),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, level, scope_key)
);

ALTER TABLE cost_ledger_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_ledger_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cost_ledger_counters
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- THE atomicity fix: a reservation is the row inserted here, but the
-- ceiling check it's conditioned on happens via the UPDATE/UPSERT against
-- cost_ledger_counters above — see durable/reservationStore.ts. The two
-- happen in the same transaction, so "check the ceiling" and "commit to
-- spending against it" can never be observed as two separate steps by a
-- concurrent transaction the way two JS event-loop turns could race.
CREATE TABLE IF NOT EXISTS cost_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  role_id TEXT NOT NULL,
  task_type TEXT NOT NULL,
  amount_usd NUMERIC(14, 6) NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('reserved', 'settled', 'released')) DEFAULT 'reserved',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE cost_reservations ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_reservations FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON cost_reservations
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Router task snapshots, keyed by (tenant_id, dedup_key). This IS the
-- idempotency store: a UNIQUE constraint + INSERT..ON CONFLICT DO NOTHING
-- is the atomic "first write wins" (durable/dedupStore.ts) — the second of
-- two concurrent submitTask() calls racing the same dedupKey, even from
-- two different router processes, gets 0 rows back from the INSERT and
-- reads the winner's row instead of creating a duplicate task. Storing the
-- full snapshot (not just a task-id pointer) means an idempotent replay
-- can return the actual task state, not just its id.
CREATE TABLE IF NOT EXISTS router_tasks (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  dedup_key TEXT NOT NULL,
  sub_agent_id TEXT NOT NULL,
  team_id TEXT NOT NULL,
  title TEXT NOT NULL,
  payload TEXT NOT NULL,
  model TEXT,
  tags JSONB NOT NULL DEFAULT '[]',
  status TEXT NOT NULL,
  result TEXT,
  error TEXT,
  approval_action_id TEXT,
  source_org_chart_task_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, dedup_key)
);

ALTER TABLE router_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE router_tasks FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON router_tasks
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Router's per-sub-agent, append-only status-transition journal.
CREATE TABLE IF NOT EXISTS task_ledger_entries (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  task_id UUID NOT NULL,
  sub_agent_id TEXT NOT NULL,
  status TEXT NOT NULL,
  note TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE task_ledger_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE task_ledger_entries FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON task_ledger_entries
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Approval-queue items (ProposedAction/RecommendationItem) + their
-- resolution. effect/verdict are JSONB since their shape varies by kind
-- (EffectDescriptor is optional and structurally forbidden on
-- recommendations — see packages/approval-queue/src/types.ts).
CREATE TABLE IF NOT EXISTS approval_queue_items (
  id UUID PRIMARY KEY,
  tenant_id UUID NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('proposed-action', 'recommendation')),
  task_type TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'resolved')) DEFAULT 'pending',
  payload JSONB NOT NULL,
  verdict JSONB,
  spot_check BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  resolved_at TIMESTAMPTZ
);

ALTER TABLE approval_queue_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE approval_queue_items FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON approval_queue_items
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Earned-autonomy counters + grants, per (tenant, task_type) — mirrors
-- AutonomyState exactly (packages/approval-queue/src/autonomyEngine.ts).
CREATE TABLE IF NOT EXISTS autonomy_counters (
  tenant_id UUID NOT NULL,
  task_type TEXT NOT NULL,
  consecutive_approvals INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT false,
  offered_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, task_type)
);

ALTER TABLE autonomy_counters ENABLE ROW LEVEL SECURITY;
ALTER TABLE autonomy_counters FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON autonomy_counters
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Paused-batch state (BatchExhaustionManager) — resumable mid-run state,
-- not append-only (rows are deleted on complete()).
CREATE TABLE IF NOT EXISTS paused_batches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('provider-billing-failure', 'ceiling-exhausted')),
  completed_task_ids JSONB NOT NULL DEFAULT '[]',
  remaining_tasks JSONB NOT NULL DEFAULT '[]',
  context JSONB,
  paused_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE paused_batches ENABLE ROW LEVEL SECURITY;
ALTER TABLE paused_batches FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON paused_batches
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Unified audit log — see header comment.
--
-- seq (not `at`) is what ordering queries actually sort by: `now()` inside
-- Postgres returns the SAME value for every statement in one transaction
-- (it's transaction-start time, not statement-execution time), so two
-- events appended in the same transaction — routine, e.g. a reservation
-- and its audit row committed together — would otherwise tie on `at` with
-- no defined order between them. A BIGSERIAL is a real monotonic sequence
-- regardless of transaction boundaries or clock resolution.
CREATE TABLE IF NOT EXISTS audit_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  seq BIGSERIAL,
  tenant_id UUID NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('cost-gate', 'approval-queue')),
  kind TEXT NOT NULL,
  ref_id TEXT,
  detail JSONB,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
ALTER TABLE audit_log FORCE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON audit_log
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Indexes for the dashboard query API (durable/queries.ts): spend/activity
-- over time windows, filtered by tenant + one more dimension.
CREATE INDEX IF NOT EXISTS idx_cost_reservations_tenant_role ON cost_reservations (tenant_id, role_id, created_at);
CREATE INDEX IF NOT EXISTS idx_cost_reservations_tenant_tasktype ON cost_reservations (tenant_id, task_type, created_at);
CREATE INDEX IF NOT EXISTS idx_task_ledger_tenant_subagent ON task_ledger_entries (tenant_id, sub_agent_id, at);
CREATE INDEX IF NOT EXISTS idx_audit_log_tenant_seq ON audit_log (tenant_id, seq DESC);
