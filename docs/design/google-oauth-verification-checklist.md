# Google OAuth verification — submission checklist (Google Calendar, PR 2B)

Owner-actioned. This is the sequence for clearing Google's one-time app verification for the
Scheduling/Event coordinator sub-agents' Calendar connect (`docs/design/tool-registry.md`
§2b/§2g). Per the agreed PR 2 sequencing this is the **first** OAuth integration built — start
this submission now in parallel with the build; the review lead time, not the code, is the
critical path.

## 1. Scope — request the narrowest one that covers the actual feature

- [ ] `https://www.googleapis.com/auth/calendar.events` — read+write on events. This is the scope
      Scheduling/Event coordinator actually need; **do not** request the blanket
      `https://www.googleapis.com/auth/calendar` scope (full account access, edit/share/delete every
      calendar) — Google's review friction and rejection risk scale with how broad the request is,
      and the narrower scope is functionally sufficient.
- [ ] Add `https://www.googleapis.com/auth/calendar.freebusy` only if availability-checking (not
      just event CRUD) is actually needed — same narrowest-scope principle.
- [ ] Confirms as **"sensitive"** tier, not "restricted" — no CASA paid third-party security audit
      applies (that's Gmail send/modify's tier). Google's own review team handles this, days-to-weeks,
      not an annual paid re-assessment.

## 2. OAuth consent screen branding

- [ ] App name, logo, and support email match Runwisely's real, public-facing identity exactly —
      reviewers compare what a user sees at the Google sign-in screen against what was submitted.

## 3. Domain and homepage

- [ ] Verify ownership of the authorized domain via **Google Search Console**.
- [ ] Homepage is publicly accessible (not behind login), hosted on the verified domain, and clearly
      describes what the app does.
- [ ] The homepage's relevance to the **specific scope under review** must be obvious to a reviewer,
      not just present — it should be clear how the calendar scope maps to a visible feature.

## 4. Privacy policy

- [ ] Same domain as the homepage.
- [ ] Linked directly from the OAuth consent screen itself.

## 5. Scope justification + demo video

- [ ] A video walkthrough showing the actual Scheduling/Event coordinator feature using the calendar
      scope.
- [ ] Written justification tying the scope directly to that demonstrated feature.

## 6. Submit via the Cloud Console Verification Center

- [ ] Confirm policy compliance, keep contact information current, declare every requested scope.

## Sources

- [Sensitive scope verification — Google for Developers](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification)
- [Brand verification — Google for Developers](https://developers.google.com/identity/protocols/oauth2/production-readiness/brand-verification)
- [Google OAuth Verification Guide (2026)](https://singhamandeep.com/google-oauth-verification-guide/)
- [Google Calendar API — auth scopes](https://developers.google.com/calendar/api/auth)

## Cross-reference

- `docs/design/tool-registry.md` §2b (Calendar), §2f (rate limits — 1M req/day, 10K/min per project),
  §2g (per-sub-agent OAuth ranking)
- `docs/DECISIONS.md` ADR-020 (OAuth credential handling this connect flow will use)
