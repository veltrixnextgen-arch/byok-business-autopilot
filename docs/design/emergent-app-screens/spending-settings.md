# Spending walls (settings) — `/app/spending`

**Purpose:** the real, interactive control surface for the spending-wall concept that `apps/web/src/components/landing/SpendingWalls.tsx` only illustrates on the marketing site. This is the screen a founder actually uses to set limits, not a static preview.

## Layout

1. **Company daily limit** — a labeled slider, live dollar value (captured at $10).
2. **Default per-agent limit** — a second labeled slider, live dollar value (captured at $1). Sets the fallback for agents that don't have their own override (see `agent-detail.md`'s per-agent budget slider).
3. **Autonomy presets** — four selectable cards, radio-style (only one active at a time), each presumably representing a named bundle of autonomy defaults (e.g. conservative → permissive) rather than per-agent configuration. Exact preset labels/descriptions weren't captured in full text this pass — worth a follow-up read before building, since the names/copy matter for a settings screen like this.
4. **Per-agent table** — columns: **Team**, **Limit**, **Used**, **Autonomy**. One row per agent, showing where each one currently sits relative to the defaults set above, and letting a founder drill into per-agent overrides from a table rather than only from each agent's own detail page.

## Notes for whoever builds this

- This is the natural home for `packages/cost-gate`'s ceilings/estimator/reservations/tier-router logic to finally get a UI — it's the settings-level view of the same wall concept the agent-detail slider exposes per-agent.
- The four "autonomy presets" need their actual copy captured before this gets built — flagging rather than guessing at labels, per the instruction not to invent content that isn't sourced.
- The per-agent table's "Used" column implies real usage tracking already needs to exist and be queryable by the time this screen is built — worth confirming `packages/cost-gate` already tracks actuals, not just limits.
