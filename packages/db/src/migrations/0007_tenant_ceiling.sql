-- Issue #15's "safety net" (roles-and-api-key-guide.md Screen 11 / userflow-v2.md
-- Stage 3 item #8): "our monthly ceiling ... editable." Before this, CostGate's
-- companyMonthlyUsd was a single value shared by the whole deployment
-- (packages/cost-gate's own ceilingConfig, constructed once at process
-- startup) — every tenant was silently bound to the SAME platform default,
-- with no way to actually change it. This column is the durable per-tenant
-- override CostGate now consults (see CostGate's ceiling-resolver support).
-- NULL means "no override set — use the platform default," not "$0" — a
-- distinction the application layer must preserve, never coalesce blindly.
ALTER TABLE tenants
  ADD COLUMN IF NOT EXISTS monthly_ceiling_usd NUMERIC(10, 2)
    CHECK (monthly_ceiling_usd IS NULL OR monthly_ceiling_usd > 0);
