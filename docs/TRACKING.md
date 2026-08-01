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
| `trust-core` | red | The four security-critical components ADR-005 CODEOWNERS-locks: router, vault, cost gate, approval queue. No AI-generated merges without human review. |
| `commodity-surface` | blue | Phase B's UI/product surface (onboarding, role cards, approval-queue UI, Charter editor, dashboard, billing) — the parts that are safe to build fast and iterate on. |
| `extraction` | green | The Task Extraction Engine: templates, customize pass, clustering/assembly, simulated-day + Charter draft generation. |
| `security` | orange | Security-specific hardening or audit work — CI scanning, CODEOWNERS coverage, key-scoping, just-in-time Hands — whether or not it also touches trust-core. |
| `test-gate` | purple | Issues that gate an MVP milestone's kill/advance criterion (master-plan-v2.md §5). See the closing rule below. |
| `docs` | gray | Documentation-only changes. |

## Rules

1. **Every PR references an issue.** Use a closing keyword (`Fixes #12`, `Closes #12`) or `Refs #12` if the PR only partially addresses it.
2. **`test-gate` issues close only with a linked passing report committed to `test/results/`.** The report is the evidence the kill/advance criterion was actually met — a `test-gate` issue does not get closed on code merged alone.
