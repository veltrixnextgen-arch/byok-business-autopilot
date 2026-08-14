-- R2 (ADR-024): router_tasks needs to durably remember which prompt-cascade
-- tier a task ran at and what system prompt it composed, so a replayed
-- idempotent read (durable/dedupStore.ts's getOrCreate/get) reconstructs the
-- SAME RouterTask the in-memory path would have — including the field that
-- decides which approval-queue pathway (submitProposedAction vs.
-- submitRecommendation, T10/ADR-004) a re-read task belongs to.
--
-- prompt_tier defaults to 'sub-agent' (matching RouterTaskInput.promptTier's
-- own default in code) so every row written before this migration existed
-- reads back as the same tier its caller already implicitly assumed.
ALTER TABLE router_tasks
  ADD COLUMN IF NOT EXISTS system_prompt TEXT,
  ADD COLUMN IF NOT EXISTS prompt_tier TEXT NOT NULL DEFAULT 'sub-agent'
    CHECK (prompt_tier IN ('ceo', 'role-lead', 'sub-agent'));
