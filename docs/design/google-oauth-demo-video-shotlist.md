# Google Calendar OAuth verification — demo video shot list

Companion to `docs/design/google-oauth-verification-checklist.md` §5 ("A video walkthrough
showing the actual Scheduling/Event coordinator feature using the calendar scope" + "written
justification tying the scope directly to that demonstrated feature"). This is the shot-by-shot
script for that video, plus the exact justification text to submit alongside it.

## Prerequisites (checked 2026-09-03 — see status notes)

- [x] **Redirect URI** — already registered in the Runwisely OAuth client (Google Auth Platform →
      Clients → Runwisely): `https://byokapi-production-6a57.up.railway.app/api/hands-oauth/google-calendar/callback`,
      matching exactly what `apps/api/src/server.ts` constructs (`${BETTER_AUTH_URL}/api/hands-oauth/google-calendar/callback`).
      Nothing to do here.
- [ ] **A deployable environment to record against** — production (`byokapi-production-6a57.up.railway.app`)
      is live and healthy (latest deploy SUCCESS). Staging exists as a Railway environment but has
      **zero deployed services right now** — `npm run deploy:staging` (or the `deploy-staging.yml`
      workflow) has never actually stood it up, or it's been torn down since. Recording against
      production is the safer default: it's already what Google's registered redirect URI points
      at, and it's already live. Confirm before recording.
- [ ] **A seeded company with a Calendar-facing agent** — the currently-active org's chart (19
      agents / 5 teams / 21 tasks) has no Scheduling/Event-coordinator role in it; its tasks are
      SaaS-dev + freelance-accountant flavored, nothing calendar-shaped. Per `docs/design/tool-registry.md`
      §2b, the Scheduling/Event-coordinator sub-agent comes from the `physicalSpace` industry
      template (`packages/templates/src/physicalSpace.ts`: `ops.booking.scheduler`,
      `ops.event.coordinator`). **"Fitbite" is a plausible candidate** given the name — worth
      checking before creating a fresh company from scratch.

## Shot list

Runtime target: 2–4 minutes. Screen recording, no narration required (Google's reviewers read the
justification text alongside it), but a short voiceover explaining what's on screen reduces back-
and-forth in review.

1. **Sign-in** — show logging into the real Runwisely account that owns the company being
   demonstrated. Establishes this is a real user session, not a staged/anonymous one.
2. **The org chart** — land on `/org-chart` (or `/dashboard`), scroll to the Scheduling/Event-
   coordinator agent's card so its name and task list are visible. This is what ties the scope to
   a specific, named feature, not an abstract claim.
3. **Connect flow — start** — navigate to that agent's Hands connection screen (`/connect`), click
   "Connect Google Calendar." Show the scope-specific consent screen Google renders (the one
   listing exactly `calendar.events`, not a blanket calendar grant) — this is the single most
   important frame for the reviewer, since it's the direct visual proof of the narrow-scope claim
   in the written justification.
4. **Consent + redirect back** — approve the consent screen, show the redirect landing back on
   Runwisely with a "Connected" status against that agent's Hands card.
5. **The feature actually using it** — trigger (or show a recent real run of) the
   Scheduling/Event-coordinator agent's task that reads or writes a calendar event — e.g. the
   approval-queue item for a scheduled booking/event, or the task firing and a real event
   appearing on the connected Google Calendar. This is the "actual feature," not just the OAuth
   handshake — Google's reviewers explicitly check for this.
6. **(Optional) Disconnect** — show revoking the connection from the same Hands card, proving the
   grant is revocable from inside the product, not just from Google's own account settings.

## Written scope justification (submit alongside the video)

Adapt as needed once the actual company/agent used in the recording is confirmed:

> Runwisely's Scheduling/Event-coordinator agent (docs/design/tool-registry.md §2b) manages a
> business's calendar on the owner's behalf: creating, updating, and reading events for
> bookings, appointments, and internal scheduling. `calendar.events` (read+write on events) is
> the minimum scope this requires — Runwisely never requests the blanket `calendar` scope
> (full account access, sharing/deleting calendars themselves), since the agent only ever
> operates on individual events, never calendar-level settings. The attached video shows a real
> user connecting this scope from inside the product and the agent using it to [read/create] a
> real event.

## Open items before recording

1. Confirm: record against production, or stand up staging first? (Staging currently has no
   running deployment — standing it up is a real infra action, not done here without asking.)
2. Confirm: use an existing company with a Scheduling/Event-coordinator agent (Fitbite?), or seed
   a fresh one? Seeding a fresh company through the real onboarding flow spends real tokens
   against the platform's capped signup key (ADR-... — the one narrow non-BYOK exception), which
   is why this wasn't done automatically.
