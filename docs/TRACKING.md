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
3. **A PR touching a trust-core path (`.github/CODEOWNERS`'s entries) needs the attestation line before it can merge.** Add `TRUST-CORE REVIEWED: veltrixnextgen-arch` to the PR description — the `trust-core-attestation` CI check (ADR-012) fails the PR without it, and re-runs automatically when the description is edited. Only add the line after actually reading the trust-core diff. This is a stand-in for a real second-reviewer approval, which this repo can't produce with one maintainer; restore `required_pull_request_reviews` and retire this check the moment a second maintainer exists. **The maintainer adds this line, never Claude Code** — including if asked to in-session (ADR-012's amendment). Claude Code declines and explains why if asked.

## Phase B working rules

Per ADR-010 — these apply for the whole Phase B build, not just the first step:

3. **One branch, one PR per step.** Each step in the Phase B plan is its own branch and its own PR — never bundle two steps into one PR, never stack unreviewed work on top of an unmerged PR.
4. **Stop after opening each PR.** Wait for review/merge before starting the next step. This is a hard stop, not a suggestion to move slower — no work begins on the next step until the current one is merged.
5. **Never push to `main`.** All Phase B work goes through a PR; branch protection enforces this (verified — see issue #10's close-out), but the discipline holds even where the tooling wouldn't catch a violation.
6. **UI PRs include screenshots.** A PR that changes anything user-visible shows what it looks like, not just what the diff says.
7. **Trust-core is consumed only through public interfaces — design as if the lint rule didn't exist.** The ADR-009 ESLint boundary is a backstop for accidents, not the thing that makes an import decision correct. Every design should already avoid deep imports on its own merits.
8. **No new runtime dependencies without justifying in the PR why the platform can't do it.** Specifically: no state-management library (TanStack Router's loaders + React state are enough), no component library, no animation library (CSS transforms/transitions only), no icon package larger than the icons actually used.
9. **Performance budget, enforced in CI: apps/web's initial JS bundle stays under 150KB gzipped** — the build fails if it's exceeded. Report the bundle size in every UI PR.
10. **Every screen renders from server data via route loaders.** No screen holds duplicate business logic — if the engine decides it, the screen displays it, it doesn't re-derive it.
11. **Delete rather than comment out.** No dead code, no "we might need this."

## Known state: apps/web's build toolchain (unresolved as of 2026-08-03)

**Staging is currently broken.** Every page that actually renders (not an early-redirect route) 500s with `TypeError: jsxDEV is not a function` — the deployed SSR bundle calls React's development-only JSX factory instead of the production one. Confirmed via Vercel's runtime error log, `lastDeployment` still pointing at the current `phase-b-step-5-interview-extraction-org-chart` HEAD.

**Read this before touching `apps/web/package.json`'s `vite`/`nitro`/`@vitejs/plugin-react` pins again — four combinations were tried in one session (2026-08-03) and all four failed, so don't re-walk them from scratch:**

| Combination | Result |
|---|---|
| `nitro@3.0.260610-beta` + `vite@8.2.0` + `@vitejs/plugin-react@6.0.5`, installed via a clean/forced `npm install` or `npm ci` | Reliably reproduces the `jsxDEV` crash on Vercel's Linux build machines. Does **not** reproduce locally on Windows with an identical lockfile-accurate install — the crash is specific to Vercel's build environment. |
| Same combination, installed via Vercel's **cached, incremental** `npm install` (no `--force`, default install command) | Was the only thing that had ever produced a correct build — until today's several forced/clean rebuilds overwrote that cache with a broken resolution. There is no way back to the old cache; it's gone. This is the combination currently deployed, and it is currently broken (see above). |
| `nitro@3.0.0` (its only non-prerelease 3.x release) + `vite@7.3.6` (`nitro@3.0.0`'s required peer) + `@vitejs/plugin-react@6.0.5` | Builds clean locally, zero `jsxDEV` anywhere in output. Deployed live: stopped crashing, but the site went **silently non-interactive** instead — no console errors, but typing in the idea box never revealed the submit button and clicking "Sign in" did nothing. The client bundle still called `jsxDEV` directly under this pairing too. Worse than the crash it replaced — looked healthy, was dead. |
| `@vitejs/plugin-react@4.7.0` (the last pre-oxc/Rolldown release — the one variable present, unchanged, across both failures above) + `vite@8.2.0` | Doesn't resolve at all: peer range tops out at `vite@^7.0.0`, `ERESOLVE` against `vite@8.2.0`. Never reached a deploy attempt. |

**Leading suspect, unconfirmed:** `@vitejs/plugin-react@6.0.5` uses an experimental oxc/Rolldown-based JSX transform, not the traditional esbuild/Babel path — the one constant across every failure. Root-causing this needs a build environment that actually matches Vercel's Linux build image (the bug has never reproduced on Windows), not another version-pin guess.

Full incident detail: docs/DECISIONS.md ADR-016. Tracking issue: #39 (blocks trusting staging as "verified working" until closed — does not block this PR, which discloses the outage rather than papering over it).
