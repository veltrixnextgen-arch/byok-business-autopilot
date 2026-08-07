# Design reference

`reference.html` is the Runwisely visual design reference: a self-contained,
bundled interactive prototype covering all ten product screens (landing,
interview, tasks, org chart, role cards, connect, charter, dashboard, queue,
digest) across three demo businesses (design studio, candle shop, mortgage
brokerage).

**The visual system is authoritative. The content is not.**

Open it directly in a browser — it unpacks itself via an embedded script, no
build step or server needed. It is a prototype, not shipped code:

- Every number, name, and task shown is hardcoded demo data for one of the
  three fictional businesses. None of it is real extraction output, and
  none of it should ever appear in `apps/web` verbatim.
- The screen tabs (`role cards`, `connect`, `charter`, `dashboard`, `queue`,
  `digest`) cover product surfaces that don't exist in `apps/web` yet —
  they're reference material for when those steps get built, not scope for
  today.
- Interaction patterns shown (e.g. tapping a team card to drill into
  individual agents) are prototype choices, not automatically a spec for
  `apps/web`'s actual data flow or edit affordances. Follow ADR-018's
  "deviations get a reason in the PR" rule when a pattern doesn't transfer
  cleanly.

What *is* authoritative: the typography scale, color and gradient
treatment, spacing rhythm, glass/card treatment, button styling, and motion
register used throughout. `apps/web/src/styles/tokens.css` was originally
extracted from this same reference (see its own top-of-file comment) — this
file is that extraction's source, kept in the repo so future fidelity work
has something concrete to diff against instead of relying on memory or
screenshots that drift out of sync.

See [ADR-018](../DECISIONS.md) for the rule this file exists to support.

## Landing page: a second reference

As of 2026-08-07, the landing route (`apps/web/src/routes/index.tsx`) is built against a different, newer reference — a live Emergent-generated prototype, not this file. See [reference-emergent.md](reference-emergent.md) for the source URL and what was measured. `reference.html` above remains authoritative for every other screen.
