-- R3 (docs/architecture/automation-runtime-plan.md §3(a)/§7/§8, ADR-025):
-- the scheduler needs to know which cadence FLOOR a tenant's subscription
-- tier allows (daily / hourly / 15min) before it can clamp a task's
-- declared cadence to something the tenant's tier actually permits.
--
-- Tier values are this product's REAL, shipped subscription tiers
-- (apps/web/src/lib/pricingConstants.ts's PRICING_TIERS: solo/company/
-- scale) — not the plan doc's "Founder/Operator/Agency" naming, which
-- doesn't exist anywhere in this codebase's actual pricing surface. See
-- ADR-025 for the full reconciliation. No tier-selection UI exists yet
-- (pricing isn't finalized — PRICING_TIERS ships "—/month" placeholders),
-- so every tenant defaults to 'solo', the most conservative (slowest)
-- floor — fail-closed, matching this codebase's whole spend-safety posture.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS tier TEXT NOT NULL DEFAULT 'solo'
    CHECK (tier IN ('solo', 'company', 'scale'));

-- One row per tenant: whether the scheduler has paused further scheduled
-- dispatch for this tenant (plan §6: "ceiling hit at 3am -> all further
-- dispatch pauses ... the resumable-exhaustion record preserves completed
-- work"). paused_batch_id points at the resumable record in paused_batches
-- (packages/cost-gate's existing exhaustion mechanism, reused here rather
-- than inventing a second one) that a resume operation replays from.
CREATE TABLE IF NOT EXISTS tenant_schedule_state (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  paused_at TIMESTAMPTZ,
  paused_reason TEXT,
  paused_batch_id UUID REFERENCES paused_batches(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenant_schedule_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_schedule_state FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON tenant_schedule_state;
CREATE POLICY tenant_isolation ON tenant_schedule_state
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- §7's required instrumentation, built alongside the scheduler rather than
-- retrofitted: "We cannot price what we cannot see... that feeds an
-- internal COGS-per-company view so the tier floors above can be corrected
-- against real data rather than these estimates." One row per tenant per
-- day, atomically incremented as events happen (see
-- packages/jobs/src/instrumentation.ts) rather than computed after the
-- fact from other tables — this is the primary record, not a derived view.
--
-- event_triggers_received and chain_steps_completed have columns now
-- (per the explicit ask: "build the meter with the scheduler, not after
-- it") but nothing increments them yet — R3 only builds cadence triggers;
-- R5 (task chains) and R6 (event triggers) are what will actually call
-- recordEventTrigger/recordChainStep. Zero rows with nonzero values in
-- those two columns is the honest, current state, not a bug.
CREATE TABLE IF NOT EXISTS scheduler_instrumentation_daily (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  day DATE NOT NULL,
  scheduled_runs_executed INTEGER NOT NULL DEFAULT 0,
  event_triggers_received INTEGER NOT NULL DEFAULT 0,
  chain_steps_completed INTEGER NOT NULL DEFAULT 0,
  ledger_rows_written INTEGER NOT NULL DEFAULT 0,
  worker_seconds_consumed NUMERIC(14, 3) NOT NULL DEFAULT 0,
  PRIMARY KEY (tenant_id, day)
);

ALTER TABLE scheduler_instrumentation_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE scheduler_instrumentation_daily FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON scheduler_instrumentation_daily;
CREATE POLICY tenant_isolation ON scheduler_instrumentation_daily
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- Internal-metrics read exception, same shape as 0005_signup_metrics.sql's
-- — an operator view across every tenant needs to read this table to
-- actually correct the tier floors against real data, which is the whole
-- point of collecting it.
DROP POLICY IF EXISTS internal_metrics_read ON scheduler_instrumentation_daily;
CREATE POLICY internal_metrics_read ON scheduler_instrumentation_daily
  FOR SELECT
  USING (current_setting('app.internal_metrics', true) = 'true');
