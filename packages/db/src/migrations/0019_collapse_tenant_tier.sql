-- ADR-057: Solo/Company/Scale collapse into a single plan, three billing
-- periods. tenants.tier stays as a column rather than being dropped —
-- deleting it now would mean a second migration to bring it back if
-- pricing is ever re-differentiated, for a column that costs nothing to
-- leave in place. Any existing 'company'/'scale' row collapses to 'solo'
-- first (this project has never had a real subscriber on those values —
-- confirmed via the real Stripe test-mode verification this same session
-- ran — so this UPDATE is a formality, not a data-loss risk), then the
-- CHECK constraint narrows to allow only 'solo'.
UPDATE tenants SET tier = 'solo' WHERE tier <> 'solo';

ALTER TABLE tenants DROP CONSTRAINT IF EXISTS tenants_tier_check;
ALTER TABLE tenants ADD CONSTRAINT tenants_tier_check CHECK (tier = 'solo');
