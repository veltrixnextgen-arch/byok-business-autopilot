-- Phase A item 2 (docs/strategy/runwisely-master-vision.md §12): a genuine
-- per-day ceiling dimension. cost_ledger_counters already scopes every
-- counter by (tenant_id, level, scope_key) with no time window at all — a
-- 'task-type-day' level with scope_key `${taskType}:${utcDay}` gets a daily
-- reset for free, since each new day is just a scope_key nothing has
-- written to yet, no cron job required. At the real scheduler dispatch call
-- site (apps/router/src/router.ts) taskType IS the individual agent's id,
-- so this is what "per-agent per-day" enforcement cashes out to.
ALTER TABLE cost_ledger_counters DROP CONSTRAINT IF EXISTS cost_ledger_counters_level_check;
ALTER TABLE cost_ledger_counters ADD CONSTRAINT cost_ledger_counters_level_check
  CHECK (level IN ('company', 'role', 'task-type', 'task-type-day'));
