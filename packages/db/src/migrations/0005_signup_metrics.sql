-- MVP-0 tester gate (Phase B Step 6C): the founder needs, per signup,
-- which screen they reached, where they dropped off, extraction cost
-- (already in signup_extraction_batches), and whether the org chart
-- actually taught them something — nothing fancier than that for a
-- 20-tester pilot. Both tables are user-scoped for writes (a tester's
-- own browser can only ever write its own rows), same withUserScope
-- discipline as 0004_signup_extraction_batches.sql. Reading ACROSS
-- users (the whole point of an aggregate metrics view) is a second,
-- narrow exception carved into the same RLS policy rather than a
-- second, parallel access path — see withInternalMetricsScope
-- (signupMetrics.ts), which sets app.internal_metrics instead of
-- app.user_id. That flag is only ever set by the token-gated internal
-- metrics route (apps/api/src/routes/internalMetrics.ts), never by
-- anything a tester's own session can reach.
CREATE TABLE IF NOT EXISTS signup_funnel_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  screen TEXT NOT NULL CHECK (screen IN ('signup', 'interview', 'tasks', 'org_chart')),
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE signup_funnel_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE signup_funnel_events FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_isolation ON signup_funnel_events;
CREATE POLICY user_isolation ON signup_funnel_events
  FOR ALL
  USING (
    user_id = current_setting('app.user_id', true)::uuid
    OR current_setting('app.internal_metrics', true) = 'true'
  )
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

CREATE INDEX IF NOT EXISTS signup_funnel_events_user_id_idx ON signup_funnel_events (user_id);

-- One row per user: a second submission overwrites the first (a tester
-- changing their mind before leaving the page), not a growing log.
CREATE TABLE IF NOT EXISTS signup_feedback (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  taught_something BOOLEAN NOT NULL,
  free_text TEXT,
  at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE signup_feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE signup_feedback FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS user_isolation ON signup_feedback;
CREATE POLICY user_isolation ON signup_feedback
  FOR ALL
  USING (
    user_id = current_setting('app.user_id', true)::uuid
    OR current_setting('app.internal_metrics', true) = 'true'
  )
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);

-- The metrics view also needs per-signup extraction cost, which already
-- lives on signup_extraction_batches (0004) — that table's own policy
-- predates this feature and only ever allowed a user to see their own
-- rows. This is a NEW migration re-declaring the SAME policy name with
-- an added internal_metrics clause (not an edit to 0004's file, which
-- stays untouched and already applied) — the standard way to change an
-- earlier migration's effect without reordering or editing it.
DROP POLICY IF EXISTS user_isolation ON signup_extraction_batches;
CREATE POLICY user_isolation ON signup_extraction_batches
  FOR ALL
  USING (
    user_id = current_setting('app.user_id', true)::uuid
    OR current_setting('app.internal_metrics', true) = 'true'
  )
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
