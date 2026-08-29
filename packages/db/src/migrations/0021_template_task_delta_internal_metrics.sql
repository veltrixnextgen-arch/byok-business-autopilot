-- Phase C item 7 (docs/strategy/runwisely-master-vision.md §12): the
-- template-learning aggregation step needs to read template_task_deltas
-- ACROSS every user, same shape of problem 0005_signup_metrics.sql already
-- solved for the funnel/feedback tables — a second, narrow exception
-- carved into the SAME policy (app.internal_metrics), never a parallel
-- access path. Only ever set by the token-gated internal metrics route
-- (apps/api/src/routes/internalMetrics.ts), never by a user's own session.
DROP POLICY IF EXISTS user_isolation ON template_task_deltas;
CREATE POLICY user_isolation ON template_task_deltas
  FOR ALL
  USING (
    user_id = current_setting('app.user_id', true)::uuid
    OR current_setting('app.internal_metrics', true) = 'true'
  )
  WITH CHECK (user_id = current_setting('app.user_id', true)::uuid);
