# Meta App Review — submission checklist (Google Calendar / Meta OAuth, PR 2)

Owner-actioned. This is the sequence for clearing Meta's one-time, platform-level review gate for
the Social manager sub-agent's Instagram/Facebook connect (`docs/design/tool-registry.md` §2b/§2g)
— Runwisely clears this once; individual businesses then connect via ordinary OAuth in minutes.
Per the agreed PR 2 sequencing (Google Calendar first, Meta second), start this submission now —
the 2–4 week review lead time is the real critical path, independent of when the code ships.

## 0. Hard prerequisite — Business Verification before App Review

**Complete this first.** Submitting App Review before Business Verification is a common,
avoidable rejection cause: Advanced Access (needed because Runwisely's app is used by end
customers, not just accounts with a Role on the app/Business) requires Business Verification to
already be done. Submit via Meta Business Manager before touching the App Review form.

## 1. App Dashboard basics

- [ ] **Privacy policy URL** — hosted on the **same domain** as the app's homepage URL.
- [ ] **Data Deletion Callback URL** (or the simpler static Data Deletion *Instructions* URL) — required
      for any app handling user data. If using the callback: HTTPS endpoint, JSON response containing
      both `url` and `confirmation_code` — returning HTML or omitting either field fails.
- [ ] **Privacy policy text names the deletion process** — a concrete path (self-service, email, or
      support channel) for a user to request deletion of what Runwisely holds about them. Reviewers
      cross-check the policy, the deletion callback/instructions page, and the requested permissions
      against each other — inconsistency between the three is a common rejection trigger.

## 2. Scopes to request

- [ ] `instagram_business_basic`
- [ ] `instagram_business_content_publish`
- [ ] `pages_manage_posts` — **only** if Facebook Pages posting is also wanted (not just Instagram).
      Requires **Advanced Access** specifically — Standard Access only works against Meta's own test
      assets, never a real customer's Page.

Request only what Social manager's actual feature uses — Meta strips or rejects permissions
requested but not demonstrated in the screencast.

## 3. Screencast — one per permission

- [ ] A separate screencast **per scope**, each showing the real Runwisely feature that uses that
      specific permission, live.
- [ ] Concrete feature names and specific data-use explanations for every scope — vague/generic
      justifications are a rejection cause.

## 4. Submit and track

- [ ] Timeline: 2–4 weeks once the above is complete.
- [ ] A rejection restarts a meaningful chunk of that clock — get the checklist right the first time
      rather than submitting early and iterating.

## Sources

- [Instagram API Advanced Access Approval Guide (2026)](https://singhamandeep.com/instagram-api-advanced-access-approval/)
- [Instagram Platform overview — Meta for Developers](https://developers.facebook.com/docs/instagram-platform/overview/)
- [Facebook Data Deletion Callback URL: App Review Guide](https://singhamandeep.com/facebook-data-deletion-callback-url/)
- [Data Deletion Request Callback — Meta for Developers](https://developers.facebook.com/documentation/development/create-an-app/app-dashboard/data-deletion-callback)

## Cross-reference

- `docs/design/tool-registry.md` §2b (Social — Meta family), §2g (per-sub-agent OAuth ranking)
- `docs/DECISIONS.md` ADR-020 (OAuth credential handling this connect flow will use once built)
