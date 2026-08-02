# Work Tracking

Issues and milestones live in GitHub. This doc explains the label system and the two rules that keep it useful.

## Milestones

In build order, matching `docs/strategy/master-plan-v2.md` §4-5:

1. **MVP-0: Extraction validated**
2. **Phase A: Trust core + shell**
3. **Phase B: Commodity surface**
4. **MVP-1: First role live**
5. **MVP-2: Full org**
6. **MVP-3: Deploy layer**

## Labels

| Label | Color | Meaning |
|---|---|---|
| `trust-core` | red | The four security-critical components ADR-005 CODEOWNERS-locks: router, vault, cost gate, approval queue. Merges require the `TRUST-CORE REVIEWED` attestation, a required CI check (ADR-012) — a real CODEOWNERS approval where more than one maintainer exists. |
| `commodity-surface` | blue | Phase B's UI/product surface (onboarding, role cards, approval-queue UI, Charter editor, dashboard, billing) — not CODEOWNERS-locked into trust-core, but still built under the same PR-per-step discipline (ADR-010) as everything else. |
| `extraction` | green | The Task Extraction Engine: templates, customize pass, clustering/assembly, simulated-day + Charter draft generation. |
| `security` | orange | Security-specific hardening or audit work — CI scanning, CODEOWNERS coverage, key-scoping, just-in-time Hands — whether or not it also touches trust-core. |
| `test-gate` | purple | Issues that gate an MVP milestone's kill/advance criterion (master-plan-v2.md §5). See the closing rule below. |
| `docs` | gray | Documentation-only changes. |

## Rules

1. **Every PR references an issue.** Use a closing keyword (`Fixes #12`, `Closes #12`) or `Refs #12` if the PR only partially addresses it.
2. **`test-gate` issues close only with a linked passing report committed to `test/results/`.** The report is the evidence the kill/advance criterion was actually met — a `test-gate` issue does not get closed on code merged alone.
3. **A PR touching a trust-core path (`.github/CODEOWNERS`'s entries) needs the attestation line before it can merge.** Add `TRUST-CORE REVIEWED: veltrixnextgen-arch` to the PR description — the `trust-core-attestation` CI check (ADR-012) fails the PR without it, and re-runs automatically when the description is edited. Only add the line after actually reading the trust-core diff. This is a stand-in for a real second-reviewer approval, which this repo can't produce with one maintainer; restore `required_pull_request_reviews` and retire this check the moment a second maintainer exists.

## Phase B working rules

Per ADR-010 — these apply for the whole Phase B build, not just the first step:

3. **One branch, one PR per step.** Each step in the Phase B plan is its own branch and its own PR — never bundle two steps into one PR, never stack unreviewed work on top of an unmerged PR.
4. **Stop after opening each PR.** Wait for review/merge before starting the next step. This is a hard stop, not a suggestion to move slower — no work begins on the next step until the current one is merged.
5. **Never push to `main`.** All Phase B work goes through a PR; branch protection enforces this (verified — see issue #10's close-out), but the discipline holds even where the tooling wouldn't catch a violation.
6. **UI PRs include screenshots.** A PR that changes anything user-visible shows what it looks like, not just what the diff says.
7. **Trust-core is consumed only through public interfaces — design as if the lint rule didn't exist.** The ADR-009 ESLint boundary is a backstop for accidents, not the thing that makes an import decision correct. Every design should already avoid deep imports on its own merits.
