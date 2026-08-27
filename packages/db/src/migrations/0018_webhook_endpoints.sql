-- R6 (docs/architecture/automation-runtime-plan.md §3(b), "Event
-- triggers"): a per-tenant webhook signing secret (one row per
-- tenant+provider — Stripe generates this when the tenant configures a
-- webhook endpoint in their own Stripe dashboard pointing at our
-- per-tenant URL, and gives it back to us to store, same "paste a
-- secret we validate/store" shape the Brain-key connect flow already
-- uses) and a durable, capture-only log of every VERIFIED event
-- (nothing dispatches from this yet — see packages/webhooks' own
-- module comments). Both tenant-scoped: neither exists before a real
-- tenant/org does, unlike the pre-org stores from earlier this session
-- (signup_extraction_batches/template_task_deltas, ADR-015).
CREATE TABLE IF NOT EXISTS webhook_endpoint_secrets (
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  secret TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, provider)
);

ALTER TABLE webhook_endpoint_secrets ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_endpoint_secrets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON webhook_endpoint_secrets;
CREATE POLICY tenant_isolation ON webhook_endpoint_secrets
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE TABLE IF NOT EXISTS webhook_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE webhook_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE webhook_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON webhook_events;
CREATE POLICY tenant_isolation ON webhook_events
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

CREATE INDEX IF NOT EXISTS webhook_events_tenant_id_received_at_idx ON webhook_events (tenant_id, received_at DESC);
