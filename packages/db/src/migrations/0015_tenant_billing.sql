-- Issue #18 (ADR-045): Stripe billing. tenants.tier already exists
-- (migration 0010) as the real, shipped subscription axis — this adds
-- exactly what's needed to tie it to a real Stripe subscription, nothing
-- more. Tenant resolution for webhook events does NOT depend on these
-- columns at all (every Stripe event this app handles carries tenantId
-- in its own metadata, set at checkout-session creation and propagated
-- by Stripe onto the resulting Subscription object) — these are stored
-- for operational/support use (looking up a tenant's Stripe customer
-- record directly) and for the "manage billing" portal-link flow, not
-- as a lookup key on the hot path.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS stripe_customer_id TEXT,
  ADD COLUMN IF NOT EXISTS stripe_subscription_id TEXT;

-- Idempotent (DROP...IF EXISTS has no CREATE INDEX equivalent that both
-- creates and names identically on a partial index across Postgres
-- versions this codebase supports, so this follows the same
-- CREATE...IF NOT EXISTS convention every other migration here uses).
CREATE UNIQUE INDEX IF NOT EXISTS tenants_stripe_customer_id_unique
  ON tenants (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tenants_stripe_subscription_id_unique
  ON tenants (stripe_subscription_id) WHERE stripe_subscription_id IS NOT NULL;
