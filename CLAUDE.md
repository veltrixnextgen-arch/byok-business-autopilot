# Repo-specific instructions

**Any PR that changes what the product actually does must update `docs/STATUS.md` and `docs/strategy/runwisely-north-star.md` §3 in the same PR as the code.** Same discipline this repo already applies to `docs/DECISIONS.md` (ADRs) and `docs/TRACKING.md` (incident history) — established 2026-09-02 after a three-week silent scheduler failure went undetected because status was only ever requested, never delivered with the work. A docs-only PR (an ADR write-up, a tracking note) is exempt — this applies to PRs that ship a real capability change, a fix, or a finding worth reconciling against the North Star's own claims.

When in doubt about what counts: if the change would make a line in `runwisely-north-star.md` §3 or `runwisely-master-vision.md`'s own reconciliation table true, false, or newly nuanced, update it in the same PR — don't leave it for someone to notice later.
