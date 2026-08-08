# Emergent reference — post-setup app screens (spec only, not built)

These six screens exist, fully designed, in the Emergent reference
(`docs/design/reference-emergent.md`'s source) but have **no counterpart in
`apps/web` today** — the underlying feature isn't built, so there's nothing
to skin. Each has trust-core logic already sitting in `packages/` with zero
consuming UI.

This directory is not a build spec for right now. Per the 2026-08-07
inventory (Phase 0), these are feature work gated on other tracks — Approvals
needs #37, Charter and Digest need #47, BYOK/Spending need #38 — and are
explicitly **not** in scope for the current fidelity-only pass. This is the
design record to pull from once each feature's turn comes, so the fidelity
work already done here doesn't have to be redone from a cold URL.

Reached via the reference's own **"Continue with the demo company"** button
on `/signin` (no account created, no password entered) and its authenticated
sidebar (Dashboard, Approvals, Company, Digest, Spending walls, Your AI key,
Charter, Settings). Captured 2026-08-07 at 1280px only — see the Phase 0
report for why 390px screenshots weren't available this session.

**Base tokens already match.** Confirmed via computed style: `body`
background is `rgb(10, 13, 22)` (`#0a0d16`), identical to
`--color-bg` and to what `reference-emergent.md` already measured for the
landing page. These app screens are the same design system, not a
different one — no new palette/type extraction needed when building them,
just the layout/content notes below plus a spacing/component check against
`tokens.css` at build time.

## Screens indexed here

| Screen | Route | Backend already exists? | Notes file |
|---|---|---|---|
| Agent detail | `/app/agent/:id` | No dedicated package — data implicit in org/agent model | [agent-detail.md](agent-detail.md) |
| Approvals queue | `/app/approvals` | `packages/approval-queue` | [approvals.md](approvals.md) |
| Company charter | `/app/charter` | No dedicated package | [charter.md](charter.md) |
| Digest | `/app/digest` | No dedicated package | [digest.md](digest.md) |
| Spending walls (settings) | `/app/spending` | `packages/cost-gate` | [spending-settings.md](spending-settings.md) |
| BYOK connect | `/app/byok` | `packages/vault` | [byok-connect.md](byok-connect.md) |

Also captured but **not** filed here because a counterpart already exists
and this is a fidelity concern, not a missing-feature one: the dashboard
shell (`/app`, vs. our `routes/dashboard.tsx` placeholder — see Phase 1 PR
C) and the mature `/app/company` team view (vs. our first-run
`OrgChartScreen` — deliberately not unified, see the inventory report's
gap #5).
