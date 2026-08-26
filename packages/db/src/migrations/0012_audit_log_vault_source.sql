-- #149/#150 (ADR-040): Vault's own audit trail now writes source='vault'
-- rows into this same shared audit_log table (PostgresDurableAuditLog),
-- alongside cost-gate and approval-queue's existing rows. 0002's original
-- CHECK constraint only allowed ('cost-gate', 'approval-queue') — every
-- itest for #149/#150 passed because it constructed Vault with `audit:
-- undefined`, which defaults to the guarded in-memory implementation in
-- dev/test (no CHECK constraint at all), never exercising this real
-- Postgres constraint. Without this migration, the first real Vault
-- operation (storeBrainKey, decryptBrainKey, etc.) in any deployed
-- environment using PostgresDurableAuditLog would fail outright on
-- INSERT — a real gap, caught only once this table's actual constraint
-- was checked against live Postgres, not assumed from a green CI run.
--
-- Postgres has no ALTER TABLE ... ALTER CONSTRAINT for CHECK constraints
-- (unlike ADD COLUMN's IF NOT EXISTS) — the constraint must be dropped
-- and recreated. Named explicitly (not the anonymous default Postgres
-- would assign) so this migration can DROP it by name idempotently on
-- every re-run, matching every other migration's re-run safety.
ALTER TABLE audit_log DROP CONSTRAINT IF EXISTS audit_log_source_check;
ALTER TABLE audit_log ADD CONSTRAINT audit_log_source_check
  CHECK (source IN ('cost-gate', 'approval-queue', 'vault'));
