# Tool registry — Brains and Hands per role

Per ADR-002, Brains (LLM providers, per-role) and Hands (service APIs, per-sub-agent, collected just-in-time) are separate key types with separate lifecycles in the vault. This registry is the data that fills them in, one row per sub-agent (`agentType`) currently defined across all six `packages/templates` business templates — not a proposal, an inventory of what the templates already declare (`tier`, `handsTool`, `handsScope`) plus the provider/service specifics those fields don't carry.

**Intended shape.** Every table below is keyed so it can become a lookup structure the extraction pipeline or the connect-flow UI reads directly (`agentType` → `{ brain, hands[] }`) — this file is the source those tables get generated or hand-copied from, not prose to summarize before implementing something else.

---

## 1. Brains — the model-tier framework

Three cost/capability tiers, already encoded in every `TemplateTask.tier` field. One column below is the *default* provider/class per tier; per-role deviations (a specific role that wants a different provider for a stated reason) are called out in each role's own row in §3, not here.

| Tier | Class | Default provider | Why default |
|---|---|---|---|
| T1 | Cheap/fast | Gemini Flash class (fallback: Claude Haiku class, GPT mini class, DeepSeek) | Highest task volume in the system lands here (triage, categorization, tracking) — price per call dominates; Google's Flash tier is the cheapest at comparable quality as of this writing |
| T2 | Mid — drafting/reasoning | Claude Sonnet class (fallback: GPT standard class) | Strongest sustained brand-voice/tone-matched prose and reliable structured drafting at a moderate price; this is where most role output actually lives |
| T3 | Frontier — strategy/high-stakes | Claude frontier class (fallback: GPT flagship class) | Long-context synthesis (Chief of Staff reading every team's summary) and the highest-stakes single outputs (compliance, specs) — price matters least here because volume is lowest |

**Rule, recorded explicitly so it never gets revisited:** every Brain requires a **developer API key**, always. **Consumer subscriptions — ChatGPT Plus, Claude Pro, Gemini Advanced, and equivalents — cannot be used programmatically, under any provider's terms of service.** A consumer subscription authenticates a human typing into that provider's own chat UI; it carries no API access and no mechanism for third-party software to place calls against it. Every provider requires a **separate developer account, a separate API key, and separate (typically prepaid-credit) billing** from any consumer subscription the user might also hold. This is universal — Anthropic, OpenAI, Google, and every other provider Runwisely might route to — not a gap specific to one vendor. `docs/product/roles-and-api-key-guide.md` Part 3 is the user-facing walkthrough for getting that key; this rule is why Part 3 never offers "already have ChatGPT Plus? Use that" as an option.

---

## 2. Hands — the service catalog

One row per distinct capability category the templates reference (via `handsTool`), collapsing template-specific spelling variants (`Resend` / `Resend/ConvertKit` / `Email` all mean "send email on the business's behalf") into one category with concrete candidate services. **Prefer OAuth wherever the service offers it; API key only as fallback** — the user clicks "Connect," they don't hunt for a key. That preference is recorded per service below, not asserted once and left implicit.

| Category | Concrete services | Auth | OAuth-capable | Typical scope | Read-only or effect-producing |
|---|---|---|---|---|---|
| Payments (own) | Stripe, Square | OAuth (Stripe Connect, Square OAuth) preferred; API key fallback | ✅ | Read charges/invoices; create invoices, send reminders | Both — reads for reporting/reconciliation, effect for invoice creation and reminder sends |
| Payments (marketplace) | Shopify Payments, Etsy Payments (via platform APIs below) | Bundled with the platform's own OAuth | ✅ | Order/payment read | Read-only |
| E-commerce platform | Shopify Admin API, Etsy API v3 | OAuth (per-platform app install) | ✅ | Inventory read/write, order read | Both — inventory levels are read+write, order status is read-only |
| Point of sale | Square, Clover, Toast | OAuth | ✅ | Transaction read, inventory read/write | Both |
| Shipping | EasyPost, Shippo (aggregators, cover most individual carriers behind one API) | API key (aggregators don't yet offer OAuth) | ❌ (aggregator layer) | Label/tracking read, status-update read | Read-only for this registry's current tasks (status/delay comms only draft, never labels) |
| Membership / booking platform | Mindbody, Wild Apricot (membership); Calendly, Acuity Scheduling (booking) | OAuth preferred (Calendly, Acuity); API key fallback (Mindbody, Wild Apricot — OAuth support varies by plan tier) | ⚠️ Partial — check plan tier at connect time | Booking/membership read, booking write | Both |
| Payroll | Gusto, Rippling | OAuth | ✅ | Hours/payroll read; payroll-run trigger is explicitly never automated (see §3, Payroll prep) | Read-only in practice — the template's own autonomy default locks payroll execution to human-always |
| CRM | HubSpot, Pipedrive, Salesforce | OAuth | ✅ | Contact/deal read+write | Both |
| Calendar | Google Calendar, Microsoft Outlook Calendar | OAuth | ✅ | Event read+write, availability read | Both |
| Shared inbox | Front, Zendesk, or delegated Gmail/Outlook access | OAuth | ✅ | Message read, draft-reply write (send stays gated by the approval queue regardless of this scope) | Both |
| Social — Meta family | Meta Graph API (Instagram + Facebook) | OAuth | ✅ | Post read (comments/DMs), post write | Both |
| Social — other platforms | TikTok API, X/Twitter API v2 | OAuth (TikTok); OAuth or API key by access tier (X) | ✅ / ⚠️ | Post read, post write | Both |
| Social — chat community | Discord | Bot-token install (OAuth-style consent screen, not per-user OAuth) | ⚠️ Effectively yes — install flow is a consent screen, not a pasted key | Channel read, message write | Both |
| Email sending | Resend, Postmark | API key (transactional-email providers standardize on this, not OAuth) | ❌ | Send | Effect-producing only — sending is what these exist for; drafting happens Hands-free |
| Newsletter / list | ConvertKit | OAuth (v4 API) or API key (legacy v3) — prefer OAuth | ✅ (v4) | List read+write, send | Both |
| Local presence | Google Business Profile API | OAuth | ✅ | Listing read+write | Both |
| Code | GitHub | OAuth App / GitHub App installation token | ✅ | Repo read; PR/branch write; **zero production credentials, ever** (locked at the template level — Build agent, `productdev.build.propose`) | Both, effect scope deliberately capped |
| Client-facing systems | *(dynamic — whatever system the specific client uses; no fixed catalog entry)* | Per-client, just-in-time (ADR-002's own example of the "collected just-in-time" case) | N/A | Determined per client relationship | Both, always `client-facing` scoped, never the business's own `own-backoffice` credential |

---

## 2b. Hands — verified registry (auth, gating, capability, cost, reliability)

§2 was written from general knowledge. This section re-derives every service in §2's "Concrete services" column against each provider's current official developer documentation (researched August 2026), plus WhatsApp Business Platform, which §2 never listed. **"Connect and it works in five minutes" is the bar** — anything requiring business verification, app/content review, a paid-plan floor, a separate developer-account approval, or manual human sign-off by the provider is flagged as gated, with how long and whether it's rejectable. Every claim below is cited; where a search pass didn't turn up a definitive answer, that's stated explicitly rather than guessed.

One structural distinction matters throughout: some gates are **platform-level** (Runwisely itself, as the app author, clears a one-time review — e.g. Meta App Review, TikTok's audit) and don't block any individual business owner once cleared; others are **per-connection** (every business hits the gate itself — e.g. Mindbody's partner approval, Google Business Profile's access-request form, Gusto/Rippling's partner pipeline). Per-connection gates are the ones that actually break the "5 minutes" promise for end users.

### Payments (own)

- **Stripe** — Auth: OAuth (Stripe Connect "Connect with Stripe" flow) if the business already has a live, verified Stripe account; the OAuth click itself is seconds. Gating: a *brand-new* Stripe account still must clear Stripe's own KYC (identity, bank, business details) before payouts work — minutes to days depending on country/business type, and Stripe can restrict/reject on risk grounds — but that verification happens directly with Stripe, not through Runwisely, and most SMBs targeted by this product already have a live account. Capability: Invoices API (create/send), Charges/PaymentIntents read — matches §2. Cost: no API fee, standard processing (~2.9%+30¢); no published hard call cap for reasonable volume. Reliability: mature, versioned, extremely well documented; KYC *requirements* themselves shift often as Stripe updates for regulators (last noted update March 2026), which can surface as new required-fields prompts for existing connected accounts without warning. Sources: [Stripe Connect onboarding](https://stripe.com/connect/onboarding), [Required verification information](https://docs.stripe.com/connect/required-verification-information).
- **Square** — Auth: OAuth ("Connect with Square"); Square's own docs describe this as seller-driven authorization, not a developer-application-approval gate. Gating: none found for the OAuth flow itself beyond the seller already having a Square account (Square does its own KYC when that account was created, outside this integration). Capability: scoped permissions cover invoices, payments, orders, inventory read/write. Cost: no API fee, standard processing fees. Reliability: stable, well documented. Source: [Square OAuth API overview](https://developer.squareup.com/docs/oauth-api/overview), [OAuth Best Practices](https://developer.squareup.com/docs/oauth-api/best-practices).

**Recommendation:** no change from §2 — both are OAuth with no per-connection review gate found, contingent on the business already holding a verified account (true for most going-concern SMBs). Flag explicitly in onboarding copy that a *brand-new* account may not be instantly payout-capable.

### Payments (marketplace) / E-commerce platform

- **Shopify Payments** — not a separate API; bundled into a Shopify store. Gating is a one-time step the merchant does directly in Shopify admin (bank/business info, approval by Shopify's underlying processor), outside any Runwisely flow.
- **Etsy Payments** — same pattern, bundled into the seller's Etsy account.
- **Shopify Admin API** — Auth: OAuth app install. Gating: **two very different paths**. A merchant can create a self-serve "custom app" from their own Shopify admin (Settings → Apps → Develop apps) and hand Runwisely an access token — no Shopify review, minutes. A *public*, Shopify-App-Store-listed app (needed if Runwisely wants one app installable by any merchant without them doing the custom-app steps) goes through Shopify's review: standard review is 2–4 weeks, "Built for Shopify" adds another 2–4 weeks, resubmissions add 1–2 weeks each (a 2026 process update introduced an AI self-review pre-check and a faster review lane, but the multi-week baseline is still current). Capability: full inventory/order read-write; as of April 2026 new public apps must use the GraphQL Admin API (REST is legacy for new builds) — a real breaking-change-adjacent shift to track. Sources: [App review process](https://shopify.dev/docs/apps/launch/app-store-review/review-process), [2026 App Store guidelines summary](https://www.codersy.com/blog/shopify-api-development-best-practices/shopify-app-store-guidelines-key-requirements).
- **Etsy API v3** — Auth: OAuth 2.0. Gating: tiered. "Seller Apps" (an app scoped to the developer's *own* shop) are "approved within minutes, no manual review queue." "Personal Apps" get a deeper review. **Commercial Access** — what a multi-tenant product like Runwisely would need to let *any* Etsy seller connect — requires an already-approved Personal App first, then a separate Commercial Access application: a real multi-step gate for the platform, not the end user. Rate limits: 10,000 requests/day, 10 QPS by default per API key/OAuth token. Sources: [Etsy Open API v3 rate limits](https://developers.etsy.com/documentation/essentials/rate-limits/), [Etsy API FAQ](https://developers.etsy.com/documentation/migration/faq/).

**Recommendation:** default to Shopify's self-serve custom-app-token path (not the App Store) and Etsy's Seller-App path (not Commercial Access) as the MVP connect flow — both genuinely hit "5 minutes" for a single business owner connecting their own store; treat the public-listing routes as a later distribution decision, not a functional requirement.

### Point of sale

- **Square** — see Payments (own) above; same low-friction OAuth.
- **Clover** — Auth: OAuth per-merchant is straightforward once Clover has approved the *developer's* production account. Gating: before Runwisely (as the integration builder) can go to production, Clover requires identity documents (passport/driver's license + proof of address) for the developer account, and each app submitted to the Clover App Market is reviewed (functional demo video, ToS/privacy docs) before merchants can install it. This is a platform-level gate for Runwisely, not a per-merchant one, but it is real and document-heavy. Sources: [Developer account approval](https://docs.clover.com/dev/docs/developer-account-approval), [App approval FAQs](https://docs.clover.com/dev/docs/app-approval-and-app-market-faqs).
- **Toast** — Auth/Gating: **heavily gated, not self-serve at all**. API access requires becoming a formal "Toast Integration Partner": an application form vetted by Toast's Business Development team, a signed partner agreement, and approval from Toast's compliance/privacy/security/legal teams, plus a certification call before production credentials are issued. No stated timeline; this is a B2B partnership process, weeks at minimum. Sources: [Partner integration overview](https://doc.toasttab.com/doc/devguide/apiPartnerIntegrationOverview.html), [Integration partnership process](https://doc.toasttab.com/doc/devguide/integrationDevProcess.html).

**Recommendation:** Square first (no developer-account gate found), Clover second (one-time platform-level document review for Runwisely, not per-merchant). **Toast should not be a live-connect default for MVP** — its partner-approval process is the closest thing in this whole registry to a hard "we may just not get this" wall; fallback is manual CSV export from Toast's own reporting UI, or draft-only vendor/inventory comms with no direct POS read.

### Shipping

- **EasyPost** — Auth: API key, self-serve signup, no approval gate. Cost: free tier covers 3,000 labels/month via EasyPost's own "Wallet Carriers"; bring-your-own-carrier-account plans add a $20/month base + $0.08/label platform fee (on top of postage); a separate SmartRate sub-API gives 500 free calls then $0.03/call. Reliability: mature, well documented REST API. Sources: [EasyPost pricing 2026](https://1teamsoftware.com/2026/02/09/easypost-new-pricing-plans-2026/), [SmartRate API FAQs](https://support.easypost.com/hc/en-us/articles/15433074900365-SmartRate-API-FAQs).
- **Shippo** — Auth: API key, self-serve checkout even for paid tiers, no approval gate. Cost: free "Starter" tier is only **30 labels/month, 1 user login** — a real small business shipping more than one order a day blows through this in a single day; Professional is $19/month for 10,000 labels/5 logins, plus $0.05/label pay-as-you-go. Sources: [Shippo pricing 2026](https://checkthat.ai/brands/shippo/pricing).

**Recommendation:** default to **EasyPost over Shippo** — EasyPost's free tier (3,000 labels/mo) is two orders of magnitude more generous than Shippo's (30 labels/mo), which is the more consequential finding here than any gating difference (both are ungated, self-serve API keys).

### Membership / booking platform

- **Mindbody** — Auth: OAuth exists, but Gating: **API access is gated behind a formal partner-application-and-approval process, and requires the business to already hold a paid Mindbody subscription** — explicitly not the self-serve-API-key pattern most SaaS platforms use. This is a platform-level gate Runwisely itself must clear before *any* Mindbody customer can connect. Source: [Mindbody Developer Program](https://partner-program-directory.partnerfleet.io/partners/mindbody-developer-program), [Mindbody Developer Tools](https://www.mindbodyonline.com/business/developer-tools).
- **Wild Apricot** — Auth: OAuth 2.0 via a dedicated `oauth.wildapricot.org` service. No formal partner-approval gate surfaced in this research (unlike Mindbody) — appears self-serve once the business has an active Wild Apricot account. **Rate limits could not be confirmed** in this pass — flagged as unverified rather than assumed. Source: [API authentication](https://gethelp.wildapricot.com/en/articles/484-api-authentication).
- **Calendly** — Auth: OAuth 2.0; registering a developer OAuth app and receiving Client ID/Secret takes "within one business day" (a short provisioning wait, not a rejectable review). Gating nuance: basic API GET/POST works on Calendly's free Basic plan, but **webhooks require a paid Standard-tier-or-above subscription** — real-time booking-change notifications aren't available to free-plan users, only polling is. Sources: [Getting Started with Calendly API](https://developer.calendly.com/getting-started), [Calendly API overview](https://calendly.com/help/calendly-api-overview).
- **Acuity Scheduling** — Auth: OAuth 2.0, self-serve client registration via the developer hub; requires an existing Acuity account (Acuity has no free consumer tier, only paid plans/trial). No formal review gate surfaced. Source: [OAuth2](https://developers.acuityscheduling.com/docs/oauth2).

**Recommendation:** default to **Calendly or Acuity over Mindbody** — both hit "5 minutes" for a business that already has an account; Mindbody's partner-approval requirement means it should not be promised as a live connect option until Runwisely clears that process. Wild Apricot is a plausible middle option pending rate-limit confirmation.

### Payroll

- **Gusto** — Auth: OAuth documented, but Gating: **production access requires Gusto's formal "Production Pre-Approval" application to their Partnerships team, plus a third-party Security Review (with VISO Trust), plus a QA certification pass** before production credentials are ever issued — explicitly recommended to complete *before* investing in the build. This is a multi-week, platform-level partner pipeline, not a per-user connect. Source: [Getting started](https://docs.gusto.com/embedded-payroll/docs/getting-started), [API Policy](https://docs.gusto.com/embedded-payroll/page/api-policy).
- **Rippling** — Auth: OAuth 2.0 or API key, but Gating: access is via Rippling's "App Shop" partner program — register an app, submit through a partner-company review channel; Rippling "aims" for a 10-day review but states "no definitive timeline... due to high demand." Also a platform-level gate, not self-serve. Source: [Partner Requirements](https://developer.rippling.com/documentation/developer-portal/getting-started/requirements), [Partner Process](https://developer.rippling.com/docs/rippling-api/4l40jykz19461-partner-process).

**Recommendation: neither Gusto nor Rippling is realistically connectable today.** Both require Runwisely itself to complete a formal partner/security-review pipeline before *any* business can link an account — this is unlike every other category in this registry, where the gate (if any) is per-connection. Until that pipeline is cleared, Payroll prep's Hands should be **read-only via a manually uploaded payroll export/CSV** from the business's existing Gusto/Rippling admin UI, not a live "Connect" button. This is consistent with — and reinforces — the existing doc's own rule that a real payroll run is never autonomous.

### CRM

- **HubSpot** — Auth: OAuth ("Connect HubSpot"), self-serve, works on free HubSpot accounts. Gating: none for a *private* integration used only by the connecting business — HubSpot's app-review process only applies to apps seeking public **App Marketplace listing**, which is a distribution decision, not a functional requirement. Cost/limits: free accounts get 100 req/10s and 250,000 req/day; OAuth apps distributed via the marketplace get 110 req/10s per installed account; developer accounts can scale to 1M req/day on higher tiers — generous for SMB volume. Sources: [API usage guidelines and limits](https://developers.hubspot.com/docs/developer-tooling/platform/usage-guidelines).
- **Pipedrive** — Auth: OAuth 2.0. Gating: same private-vs-public distinction as HubSpot, but Pipedrive's own docs are explicit that **public Marketplace app reviews may take up to 21 business days** — worth knowing if Runwisely eventually needs a Marketplace-listed multi-tenant app rather than per-business private credentials. Source: [App approval process](https://pipedrive.readme.io/docs/marketplace-app-approval-process).
- **Salesforce** — Auth: OAuth 2.0 via a Connected App — setting one up is a moderately technical step, more admin-console work than a one-click "Connect" for a non-technical owner. Gating: **whether the business's Salesforce plan even includes API access at all depends on edition** — lower SMB-tier editions (Essentials/Starter-class plans) have historically not included API access by default, requiring an upgrade or add-on before this integration can work at all — a plan-tier gate specific to Salesforce among the three CRMs here. Rate limits once available: Enterprise/Professional-with-API get 100,000 calls/day + 1,000 per user license (generous). Source: [API Limits and Monitoring Your API Usage](https://developer.salesforce.com/blogs/2024/11/api-limits-and-monitoring-your-api-usage).

**Recommendation:** HubSpot as default (broadest free-tier functionality, no plan-tier API gate found); Pipedrive as a solid second. **Deprioritize Salesforce as a default** for this product's SMB audience — not because of OAuth friction, but because the business's own Salesforce plan may simply not include API access.

### Calendar

- **Google Calendar** — Auth: OAuth 2.0, standard Google consent screen. Gating: Google classifies Calendar scopes as **"sensitive"** (a lighter tier than "restricted") — production apps requesting them need Google's standard OAuth app verification (justification + demo video, review time of days to weeks, Google can reject/request changes) but **not** the paid third-party CASA security audit that restricted scopes trigger (see Gmail below). This is a one-time **platform-level** step for Runwisely, not something each connecting business owner does. Cost: free, generous default quota. Sources: [Sensitive scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/sensitive-scope-verification), [Choose Google Calendar API scopes](https://developers.google.com/workspace/calendar/api/auth).
- **Microsoft Outlook Calendar (Graph API)** — Auth: OAuth 2.0 via an Azure AD (Entra ID) app registration. Gating: **delegated** permissions (acting as the signed-in user, e.g. `Calendars.ReadWrite`) generally do *not* require a separate admin-consent step when the connecting user is themselves the tenant admin — common for a small-business owner on their own Microsoft 365 subscription. If the connecting user is an employee of a larger org (not an admin), a real IT admin would need to grant consent — a real but audience-dependent gate. Source: [Admin consent requirements](https://learn.microsoft.com/en-us/graph/migrate-azure-ad-graph-configure-permissions), [Do I need admin consent on calendar operations?](https://learn.microsoft.com/en-us/answers/questions/39209/do-i-need-admin-consent-on-calendar-operations).

**Recommendation:** both are fine defaults; Google's verification is a one-time platform build step, not a per-user blocker. Route by whichever ecosystem (Google Workspace vs. Microsoft 365) the business already uses.

### Shared inbox

- **Front** — Auth: OAuth 2.0 (required for "public"/partner integrations) or API token for internal use. Gating: no formal review gate for API access surfaced in this pass, though whether a *broader distributed* OAuth integration needs Front's sign-off wasn't fully confirmed — flagged as unverified. Rate limits: 50–200 req/min depending on the business's own Front plan (Starter/Pro/Enterprise); partner OAuth calls get a separate 120 req/min bucket that doesn't count against the customer's own limit. **Real gate: Front itself is a paid product** — the business must already be paying for Front before this category applies. Source: [Rate limits](https://dev.frontapp.com/docs/rate-limiting).
- **Zendesk** — Auth: OAuth 2.0 (required for multi-account distribution) or API token. Gating: no formal app-review found blocking functional OAuth access; Marketplace listing is separate. Rate limits: 200 req/min (Team plan) up to 2,500 (Enterprise Plus). **Real gate: also a paid product** the business must already own. Source: [Rate limits](https://developer.zendesk.com/api-reference/introduction/rate-limits/).
- **Gmail delegated access** — Auth: OAuth 2.0 against the Gmail API. **Gating is the sharpest finding in this whole category**: `gmail.send` and `gmail.modify` are Google **restricted** scopes (a stricter tier than Calendar's "sensitive"), which require passing Google's full **CASA security assessment** — a paid third-party audit (roughly a few hundred to a few thousand dollars/year, re-assessed annually) — once the app serves real users beyond a small internal-testing cap. This is a platform-level gate for Runwisely, but a materially more expensive and heavier one than Calendar's. Sources: [Restricted scope verification](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification), [Google CASA overview](https://deepstrike.io/blog/google-casa-security-assessment-2025).
- **Outlook delegated access** — Auth: OAuth 2.0 via Microsoft Graph (`Mail.Send`/`Mail.ReadWrite` delegated). No equivalent third-party paid security-audit requirement was found comparable to Google's CASA — delegated mail permissions follow the same lighter consent pattern as Outlook Calendar above.

**Recommendation:** where the business is on Microsoft 365, **prefer Outlook delegated access over Gmail** for this category — it avoids Google's CASA gate entirely. Where Gmail is the only option, request only `gmail.readonly` plus draft-creation (never `gmail.send`) to stay out of the restricted-scope/CASA tier, and route actual sending through a human clicking send in their own Gmail — which is exactly the existing doc's "known-answer replies earn autonomy, everything else stays draft" design, just now justified by a concrete gating reason. Front/Zendesk are better defaults only when the business already pays for one of them.

### Social — Meta family (Instagram + Facebook)

- **Instagram (Meta Graph API)** — Auth: OAuth via Facebook Login; the Instagram account must be a Business or Creator account linked to a Facebook Page. Gating: publishing requires two permissions cleared through **Meta App Review** — `instagram_business_basic` and `instagram_business_content_publish` — for any account the app doesn't itself own; review takes **2–4 weeks per submission**, requires a screencast demo, and can require resubmission. This is a **platform-level** gate: Runwisely clears it once, then individual businesses connect via ordinary OAuth in minutes. Source: [Instagram Graph API 2026 guide](https://www.netrows.com/blog/instagram-graph-api-guide-2026), [Elfsight Instagram Graph API guide](https://elfsight.com/blog/instagram-graph-api-complete-developer-guide-for-2026/).
- **Facebook Pages** — Auth: same OAuth via Facebook Login. Gating: `pages_manage_posts` requires **Advanced Access** (App Review + Business Verification) to post on Pages the app doesn't own; **Standard Access only works against the developer's own test assets** — so without clearing review, nothing can be posted to a real customer's Page at all. Same 2–4-week-class review cycle. Source: [Facebook Page API Permissions App Review guide](https://singhamandeep.com/facebook-page-api-permissions-app-review/).

**Recommendation:** proceed with Meta as a primary social channel — the gate is real but one-time and platform-level, not a per-user blocker — while being explicit in any product timeline that this review (plus Business Verification) must be cleared *before* the Social manager sub-agent's posting capability can go live for anyone.

### Social — other platforms

- **TikTok Content Posting API** — Auth: OAuth 2.0. Gating: same platform-level pattern as Meta — production posting access requires a separate **audit** (privacy policy, demo video of the full OAuth+upload flow, data-handling description) beyond basic developer signup. While the audit is pending, the app is stuck in development mode: all posts forced to `SELF_ONLY` (private) and only 5 accounts can authorize per 24 hours — unusable for real customers until it clears. A clean submission takes roughly 1–2 weeks in 2026; incomplete ones take longer. Source: [TikTok Content Posting API guide 2026](https://www.netrows.com/blog/tiktok-content-posting-api-guide-2026).
- **X/Twitter API v2** — Auth: OAuth 2.0. Gating/cost is the headline finding here: as of the most recent info found (dated February 2026), **X discontinued its free tier for new developers and moved to pay-per-use by default** — $0.015 per post created (**$0.20 if it contains a link**), $0.005 per read (capped at 2M reads/month); the legacy Basic ($200/mo) and Pro ($5,000/mo) subscriptions are closed to new signups; Enterprise runs ~$42,000/month. There is no meaningful free tier left for a new integration. Source: [X API Pricing 2026](https://postproxy.dev/blog/x-api-pricing-2026/), [Elfsight X API guide 2026](https://elfsight.com/blog/how-to-get-x-twitter-api-key-in-2026/). **Explicitly flagged as uncertain**: X's pricing has changed multiple times since 2023 and these figures should be re-verified against `developer.x.com` immediately before implementation, not treated as stable.

**Recommendation:** TikTok — proceed like Meta (one-time platform audit, ~1–2 weeks, then fast per-user OAuth). **X should be actively deprioritized**, not just "locked behind draft mode" — even after autonomy is earned, posting now carries a real per-post dollar cost with no functioning free tier, which changes its economics from "free OAuth social channel" to "paid API with per-action billing." Keep X strictly draft-only; if a template's owner insists on X, the fallback is the owner posting manually from their own account.

### Social — chat community

- **Discord** — Auth: bot-token install via an OAuth-style authorize-and-add-to-server consent screen, matching §2's existing description. Gating: a bot only needs Discord's formal verification once it either (a) joins 100+ servers, or (b) is reachable by 10,000+ unique users across servers it's in for **privileged intents** (a 2026 policy change moved this from a flat 100-server threshold to a user-count threshold). For Runwisely's actual use case — one bot per business's own single Discord server — this threshold is very unlikely to be hit, so Discord genuinely is close to "5 minutes" at this product's scale. Source: [Discord Privileged Intents Update 2026](https://blogs.arkcore.arkdevlabs.com/discord-privileged-intents-10000-user-update), [Getting Started with Privileged Intent Review](https://docs.discord.com/developers/gateway/getting-started-with-privileged-intent-review).

**Recommendation:** no change — Discord is one of the least-gated integrations in this entire registry at the scale this product operates.

### WhatsApp Business Platform (Cloud API) — evaluated, not currently in any template's `handsTool`

Not in §2 at all; researched per this task's instruction to check whether it should be added. **Finding: it should not be added as a default Hands option.** Auth is not a simple third-party OAuth "Connect" — a business owner must go through Meta Business Suite / WhatsApp Manager (or a Business Solution Provider partner) and clear, in sequence: (1) **Meta Business Verification** (legal business documents, typically 2–5 business days, up to 14 days in some cases), (2) dedicated phone number registration and an approved display name, (3) a published privacy policy URL, and (4) **Meta review of every individual message template** used for business-initiated contact outside a 24-hour customer-service window (minutes to 24 hours per template, and templates carry an ongoing "quality score" that can restrict sending if flagged). Capability once through all of this: template-based business-initiated messages, plus free-form replies inside the 24-hour window after a customer messages first. Cost: Meta's conversation/template-category-based pricing, not free at volume. Sources: [WhatsApp Business Platform docs](https://developers.facebook.com/documentation/business-messaging/whatsapp/about-the-platform), [WhatsApp Business API 2026 readiness checklist](https://blueticks.co/blog/do-i-need-whatsapp-business-api).

**Recommendation / graceful fallback:** don't wire WhatsApp Cloud API into any sub-agent for MVP. If a template's audience is WhatsApp-heavy, the fallback is **draft-only**: the agent prepares the message text, and a human sends it from the free consumer WhatsApp Business *app* (not the Cloud API) — no template pre-approval applies to a human typing in that app.

### Email sending

- **Resend** — Auth: API key. Gating: the real friction is **domain verification, not account review** — the business must add a sending subdomain and create SPF/DKIM DNS TXT records, with propagation taking up to 24 hours before the domain shows "Verified." This requires DNS/registrar access, which a non-technical owner often doesn't have themselves — a genuine setup step, just not a rejectable human-review gate. No manual account-approval process was found (searched specifically, found none — noted as absence-of-evidence, not confirmed absence). Source: [Resend domain authentication guide](https://resend.com/blog/email-authentication-a-developers-guide), [DMARC setup for Resend](https://dmarcdkim.com/setup/how-to-setup-resend-spf-dkim-and-dmarc-records).
- **Postmark** — Auth: API key. Gating: **confirmed manual review** — every new account is reviewed before it can send outside its own verified domains; Postmark's own docs say under 24 hours on weekdays, but real user reports cite 3–7 days, and **accounts can be declined even after full DNS setup**, specifically for not looking like high-engagement transactional-only use. Sources: [How does the account approval process work?](https://postmarkapp.com/support/article/1084-how-does-the-account-approval-process-work), [Postmark's new approval process](https://postmarkapp.com/blog/our-new-approval-process).

**Recommendation:** default to **Resend over Postmark** — Postmark's confirmed, sometimes multi-day, rejectable manual review is a stronger gate than Resend's DNS-only friction. Resend's DNS step is still real: offer a guided walkthrough for the business owner's registrar, and as an ultimate fallback for an owner who can't/won't touch DNS, degrade to draft-only (human sends from their own existing email client).

### Newsletter / list

- **ConvertKit (Kit) v4** — Auth: OAuth 2.0 preferred (mandatory if Runwisely wants to publicly list/distribute the integration); a personal API Secret exists but is meant for single-user automation, not third-party apps. Gating: no review/approval process surfaced for registering an OAuth application — appears self-serve via account settings. Source: [Kit API overview](https://help.kit.com/en/articles/9902901-kit-api-overview), [Kit Developer Documentation](https://developers.kit.com/api-reference/authentication).

**Recommendation:** no change — keep as default for this category.

### Local presence

- **Google Business Profile API** — Auth: OAuth 2.0, but Gating: **among the most gated integrations in this entire registry**. Unlike almost every other Google API (self-serve, enable-in-console), Business Profile requires submitting a separate "Application for Basic API Access" business-use-case form; review takes up to 14 days, rejections are described as common for vague/thin applications, and best practice is to apply only once the business's own Google Business Profile has been verified and active for 60+ days. After approval, each of the 8 separate Business Profile sub-APIs must be manually enabled. Free of per-call charges once granted. Sources: [Google Business Profile API prerequisites](https://developers.google.com/my-business/content/prereqs), [How to complete the GBP API access request form](https://legalclarity.org/how-to-complete-the-google-business-profile-api-access-request-form/).

**Recommendation:** treat as **must-stay-draft-only for MVP** — do not promise live GBP publishing. The SEO agent drafts the post/review-response text; the human pastes it into the Business Profile app or web UI themselves, which requires no API access at all.

### Code

- **GitHub** — Auth: GitHub App installation (GitHub's own recommended pattern over OAuth Apps) — the business owner clicks Install, picks repos, grants fine-grained permissions (e.g. Contents: read/write, Pull requests: read/write). Gating: **installing a private, unlisted GitHub App requires no review at all** — this is the realistic pattern for Runwisely (each business installs its own private app onto its own repos). GitHub Marketplace *listing* (public discoverability/monetization) has separate requirements (100+ installs for paid listings, publisher verification, webhook wiring for plan-change events) — but that's a distribution decision, not a functional-access gate. Sources: [Requirements for listing an app](https://docs.github.com/en/apps/github-marketplace/creating-apps-for-github-marketplace/requirements-for-listing-an-app), [GitHub App vs. OAuth](https://nango.dev/blog/github-app-vs-github-oauth/).

**Recommendation:** no change — and this is a **"less gated than assumed" finding**: the extra-scrutiny flag was reasonable to check, but for the private-install pattern this product actually needs (one business, its own repos, no Marketplace listing), there is no review gate at all.

---

## 2c. Headline findings — what turned out more/less gated than §2 assumed

**More gated than assumed:**
- **Toast, Mindbody, Gusto, Rippling** — all four require a formal partner/security-review *pipeline* (weeks, sometimes with no fixed timeline) before Runwisely itself can offer a live connect option — this is a materially different, heavier category of gate than "OAuth with a scope" and wasn't distinguished in §2.
- **Gmail send/modify scopes** — trigger Google's paid, annually-renewed CASA security audit (restricted scopes), a real cost and ongoing compliance burden §2's "OAuth ✅" glossed over; Outlook's equivalent delegated permissions do not.
- **Google Business Profile API** — a hidden, rejectable, up-to-14-day access-request gate that doesn't match the self-serve pattern of every other Google API in this registry.
- **X/Twitter** — no longer just an OAuth-tier question; it now carries real per-post/per-read dollar costs with no functioning free tier for new developers, changing its category entirely.
- **WhatsApp Business Platform** — a multi-layered business-verification-plus-per-template-review gate; correctly excluded from §2 originally, and should stay excluded from live automation now.
- **Meta (Instagram/Facebook) and TikTok** — genuinely gated (2–4-week App Review / audit), but the gate is platform-level and one-time, not per-user — §2's plain "✅ OAuth-capable" undersold the one-time cost but wasn't wrong about the steady-state per-user experience.

**Less gated than assumed:**
- **GitHub** — the private-GitHub-App-install pattern this product needs has no review gate at all; only the optional public Marketplace listing does.
- **Discord** — verification thresholds (100 servers / 10,000 reachable users) sit far above this product's one-bot-per-business-server scale.
- **Stripe, Square, HubSpot, ConvertKit/Kit, EasyPost, Shippo, Calendly, Acuity** — functionally confirmed as close to "OAuth/API-key and go" for a business connecting its own existing account, matching §2's assumption.

---

## 2d. Three-way breakdown — what the connect screen can honestly promise, by sub-agent

Keyed to every sub-agent in §3, classified by what its Hands capability can deliver **today**, per the verified findings in §2b/§2c above.

**Fully automatable today** (OAuth or API key, no per-connection gate, ~5 minutes):
Chief of Staff, Cash-flow forecast, Tax-deadline tracker (all Hands-free) · Content writer (Hands-free in 5/6 templates) · Ad-creative, Compliance review, Safety & waivers, Job-post writer, Applicant summarizer, Spec writer (all Hands-free, draft-only by template design) · Lead qualifier, CRM hygiene, Proposal builder, Outreach drafter (draft/read portion) — HubSpot/Pipedrive · Scheduling, Event coordinator — Google/Outlook Calendar · Inventory, Fulfillment/logistics — via Shopify custom-app-token/Etsy Seller-App and EasyPost respectively · Build agent, QA/smoke-test agent, Deploy coordinator — GitHub private App install · Social manager, Onboarding (Discord path) — Meta/TikTok/Discord, **contingent on Runwisely's own one-time Meta/TikTok App Review already being cleared** (a platform-level, not per-user, prerequisite).

**Needs a user setup step elsewhere** (name the step):
- Invoicing, Expense categorization — business must already hold a **verified** Stripe or Square account (KYC done directly with the provider).
- Email marketing, Onboarding (email path) — business must complete **domain DNS verification** (SPF/DKIM records) with Resend, or accept Postmark's manual review risk.
- Tier-1 triage — if using Front/Zendesk, business must already be a **paying customer** of that helpdesk tool; if using Gmail, must be scoped to read+draft only to avoid Google's CASA gate.
- Vendor manager, Booking scheduler, Membership tracking — realistic only via Square/Clover (not Toast) or Calendly/Acuity (not Mindbody) as named above; the underlying service choice *is* the setup step.
- Delivery handoff — Client-facing systems are inherently per-client, just-in-time credential collection by ADR-002's own design; there's no generic "connect" step to promise.

**Must stay draft-only realistically** (gating makes real automation impractical for MVP):
- **Payroll prep** — Gusto and Rippling both require Runwisely to clear a formal partner/security-review pipeline before *any* customer can connect; until then this is read-only via a manually uploaded payroll export, reinforcing (not just matching) the existing "payroll run is never autonomous" rule.
- **Membership billing** — Mindbody's partner-approval gate blocks a live connect option; Wild Apricot is a plausible unblocked alternative pending rate-limit confirmation, but Mindbody itself should not be promised.
- **SEO agent** (Google Business Profile capability) — the GBP API's up-to-14-day, rejectable access-request gate rules out live publishing for MVP; the agent should only ever draft post/response text for a human to paste in manually.
- **Service delivery, Delivery QA** — already permanently locked by template design regardless of Hands gating (paid deliverable / QA-only), consistent with existing doc, not a new finding.
- **Social manager (X path only)** — even with earned autonomy, X now carries real per-post/per-read cost with no free tier; recommend keeping this specific platform's posting path draft-only irrespective of the general OAuth story, and prioritize Meta/TikTok/Discord as the live-posting defaults instead.
- **Any future WhatsApp use** — should launch, if ever, already scoped to draft-only per the fallback above; not a regression from an existing capability, since WhatsApp was never live to begin with.

---

## 2e. CRITICAL — the live connect UI has no OAuth path (found re-verifying this registry against #22, August 2026)

Issue #22 shipped an inline "connect" affordance on every Hands badge in the org chart
(`HandsConnectPanel`, `apps/web/src/components/OrgChartScreen.tsx:611-676`). It is **one generic
component for every service**: a single password-type text input labeled `Paste your {tool} API
key`, wired identically regardless of what `tool` actually is (`OrgChartScreen.tsx:654-661`,
`handleConnect` at 634-645 posts straight to `POST /me/hands-keys` as an opaque string — see
`apps/api/src/routes/handsKeys.ts`).

That's a harder failure than §2b/§2c's gating findings. Gating means *some* businesses get turned
away at a review wall. This means **the UI has no way to complete a connection for any OAuth-only
service, for any business, ever** — there is no key to paste. Cross-referencing §2b's per-service
auth column against every `handsTool` string actually declared in `packages/templates` today:

| `handsTool` string (as declared in templates) | Real auth shape | Paste-a-key UI works? |
|---|---|---|
| `Instagram/Meta`, `Instagram/Facebook`, `Instagram/TikTok` | OAuth only (Meta Graph API / TikTok Content Posting API) — no API-key concept exists | **No — structurally impossible** |
| `Google Business` | OAuth only, plus the §2b access-request gate | **No** |
| `Calendar` (Google Calendar / Outlook) | OAuth only | **No** |
| `GitHub` | GitHub App installation (OAuth-style consent + install), not a bearer key a user has sitting around | **No, not the intended pattern** — a PAT would technically parse but isn't what §2b recommends and carries a human's full account scope, not the app's fine-grained one |
| `Twitter/X` | OAuth 2.0 (or paid API-key tier, see §2b) | **Partial** — OAuth path broken, paid key-tier path technically pastable |
| `Booking platform`, `Membership platform`, `Membership/payment platform` (Calendly/Acuity/Mindbody/Wild Apricot) | OAuth (Calendly, Acuity, Wild Apricot) or partner-gated (Mindbody) | **No**, except wherever a provider exposes a legacy personal token |
| `Stripe`, `Square` | OAuth preferred, but both also issue a pasteable secret/access token | **Yes, works today** (not the 5-minute OAuth click §2b recommends, but functional) |
| `Shopify/Etsy` | Shopify custom-app token is pasteable; Etsy API v3 needs an OAuth-issued token, no static key | **Partial** — Shopify yes, Etsy no |
| `CRM` (HubSpot/Pipedrive/Salesforce) | HubSpot private-app token is pasteable; Pipedrive/Salesforce lean OAuth | **Partial** — HubSpot yes |
| `Resend/ConvertKit`, `Email`, `Shipping carrier`, `Discord`, `Payroll provider` | API key (Resend, EasyPost/Shippo) or bot-token install (Discord, itself a pasteable secret) or moot (Payroll — already gated off in §2d regardless) | **Yes, works today** |

**Net effect:** every sub-agent whose Hands badge is Meta/TikTok social, Google Calendar, Google
Business, or most booking/membership platforms hits a dead end on the *first* click, independent of
whether that business would have cleared Meta's App Review or Google's access-request form. This is
the more urgent half of the concern that prompted this addendum — a business-verification wall at
least lets *some* users through; a missing input type lets through *none*. §2d's "fully automatable
today" list below is now understood to describe backend/provider-side readiness only, **not** what
today's actual connect UI can complete — real OAuth support (or, at minimum, disabling the connect
affordance for OAuth-only tools in favor of an honest "not yet connectable, working in draft mode"
state) is unbuilt follow-up work, not a documentation gap.

## 2f. Rate limits — closing §2b's coverage gap (researched August 2026)

§2b left rate limits unconfirmed for most services outside a handful (Etsy, HubSpot, Front, Zendesk,
Salesforce). Filled in below for every service actually reachable through a template's `handsTool`
today, keyed the same way as §2b. None of these change any §2b/§2c/§2d recommendation on their own —
they're additive context for capacity planning once a real connection exists — except where noted.

- **Stripe** — 100 req/s live mode (25 req/s sandbox); stricter sub-limits on specific endpoints (Files API 20 read + 20 write/s, Search API 20 read/s, Payouts 15 req/s + 30 concurrent/business). Far above any single SMB's real call volume. Source: [Stripe rate limits](https://docs.stripe.com/rate-limits).
- **Square** — no single published blanket number; documented per-endpoint (e.g. Team API 35 req/s/application), 429 + exponential-backoff-with-jitter is the documented handling pattern. Source: [Square error handling](https://developer.squareup.com/docs/build-basics/general-considerations/handling-errors).
- **Shopify Admin API (GraphQL)** — cost-based, not request-count: standard plans get a 1,000-point bucket restoring 50 points/s (Shopify Plus: 2,000-point bucket, 100–500 points/s depending on sub-plan); 1,000 points is a hard per-query ceiling regardless of plan. Comfortably sufficient for the Inventory/Fulfillment sub-agents' read-heavy, batched pattern. Source: [Shopify GraphQL Admin API rate limits](https://no7software.co.uk/blog/shopify-graphql-admin-api-rate-limits-production).
- **Meta Graph API (Instagram/Facebook)** — Business Use Case model: 200 calls/user/hour, scaling with the app's total impressions (4,800 × impressions/24h) rather than a flat app-wide cap; private-reply calls capped separately at 750/hour/Page. Generous for one business's own account, but this is moot until §2e's OAuth gap is closed. Source: [Meta Graph API rate limiting](https://developers.facebook.com/docs/graph-api/overview/rate-limiting/).
- **TikTok Content Posting API** — 6 requests/minute per user token, daily cap of roughly 15–25 videos/account (tier-dependent, shared across all API clients, not all published). Also moot until §2e's OAuth gap is closed. Source: [TikTok API rate limits 2026](https://www.getphyllo.com/post/tiktok-api-rate-limits-in-2026-quotas-errors-workarounds).
- **WhatsApp Business Cloud API** (evaluated, still not recommended per §2's WhatsApp writeup) — throughput ~80 messages/second standard tier (up to 1,000 mps at the enterprise "Unlimited" tier); separate messaging-tier cap (1K/10K/100K unique contacts/24h) gated by phone-number quality rating and, since October 2025, shared across every number in one Meta Business Portfolio rather than per-number. Doesn't change the existing "don't wire this in" recommendation — the business-verification and per-template-review gates in §2 remain the binding constraint, not throughput. Source: [WhatsApp messaging limits 2026](https://chatarmin.com/en/blog/whats-app-messaging-limits).
- **Google Calendar API** — 1,000,000 requests/day/project (currently unbilled, Google states billing details arrive later in 2026 with 90 days' notice); per-minute 10,000 req/min/project and 600 req/min/user/project for projects created on/after May 1 2026 (older projects keep prior quotas). Sliding-window enforcement, 403/429 on breach. Ample for Scheduling/Event coordinator's read+write pattern. Source: [Google Calendar API usage limits](https://developers.google.com/workspace/calendar/api/guides/quota).
- **Microsoft Graph (Outlook Calendar/Mail)** — ~4 req/s/app/mailbox for calendar GETs specifically, with a 10,000-requests-per-10-minutes burst allowance shared across mail/calendar/contacts endpoints (≈16 req/s/mailbox sustained); a separate 130,000-req/10s/app global ceiling across all tenants. 429 + `Retry-After` on breach. Source: [Microsoft Graph throttling limits](https://learn.microsoft.com/en-us/graph/throttling-limits).
- **Google Business Profile API** — QPM + QPD dimensions, but **every new GCP project starts at zero quota** until the §2b access-request form is separately approved (a second, quota-specific gate layered on top of the already-documented up-to-14-day access gate); Business Information API further caps at 10 edits/minute/listing once granted. Reinforces §2d's existing "must stay draft-only for MVP" call — now for two independent gates, not one. Source: [Google Business Profile API limits](https://developers.google.com/my-business/content/limits).
- **GitHub Apps** — installation tokens get a minimum 5,000 req/hour, scaling up with the installation's repo/user count to a 12,500 req/hour ceiling (15,000 req/hour on GitHub Enterprise Cloud orgs). Far above what Build/QA/Deploy agents need per business. Source: [GitHub App rate limits](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/rate-limits-for-github-apps).
- **Calendly** — 60 req/min (Free/Standard/Teams), 120 req/min (Enterprise). Source: [Calendly API rate limits](https://www.stitchflow.com/user-management/calendly/api).
- **Kit (ConvertKit) v4** — 120 requests/rolling-60s per API key (≈2 req/s average), shared across every caller using the same key. Source: [Kit API overview](https://help.kit.com/en/articles/9902901-kit-api-overview).
- **Resend** — flat 2 req/s per account on every tier including Free (Free plan additionally caps at 3,000 emails/month, 100/day, one domain — the send-volume ceiling binds well before the rate limit would). Source: [Resend API rate limit changelog](https://resend.com/changelog/api-rate-limit).

**Still unconfirmed after this pass** (absence of evidence, not confirmed absence — flagged rather than guessed): Acuity Scheduling, Mindbody, Wild Apricot, Clover, Toast, Gusto, Rippling, Postmark, Pipedrive. All but Postmark are already flagged draft-only or heavily gated in §2b/§2d for reasons independent of throughput, so the missing number doesn't currently change any recommendation; re-check before any of them moves off draft-only.

## 2g. Per-sub-agent recommendation, ranked by OAuth + no approval gate + free tier

Every Hands-touching sub-agent from §3, one row, ranked service choice first by (1) OAuth available,
(2) no per-connection approval gate, (3) usable free tier — in that order, consistent with §2's
stated OAuth-first principle. "Today's UI" reflects §2e's finding, not just backend readiness.

| Sub-agent | Recommended service | Meets OAuth+no-gate+free-tier? | Today's UI (post-#22) |
|---|---|---|---|
| Invoicing, Expense categorization | Stripe | OAuth ✅, no per-connection gate ✅ (contingent on pre-existing verified account), free ✅ (no API fee) | **Works** — Stripe has a pasteable secret key fallback |
| Membership billing | Wild Apricot over Mindbody | OAuth ✅, no gate found (unconfirmed rate limit) vs. Mindbody's partner-gate ❌ | **Broken** — OAuth-only, no paste fallback |
| Social manager | Meta (Instagram/Facebook) over TikTok/X | OAuth ✅ (one-time platform review, not per-user), free ✅, but real per-connection review only for Runwisely itself | **Broken today** — §2e; also contingent on Runwisely's own Meta App Review, unconfirmed as cleared |
| Email marketing | Resend over Postmark/ConvertKit | API key (not OAuth, but no review gate) ✅, free tier ✅ (3,000/mo) | **Works** |
| SEO agent (Google Business Profile) | — (draft-only by design) | OAuth exists but **two** stacked gates (§2f) | **Broken** — moot, stays draft-only regardless |
| Tier-1 triage | Outlook over Gmail | OAuth ✅, no CASA-class gate ✅, free tier depends on the business's own O365 subscription | **Broken** — OAuth-only |
| Lead qualifier, CRM hygiene | HubSpot over Pipedrive/Salesforce | OAuth ✅, no gate for private use ✅, free tier ✅ (100 req/10s, 250K/day) | **Works** — HubSpot has a pasteable private-app token |
| Scheduling, Event coordinator | Google Calendar over Outlook | OAuth ✅, no gate (Calendar's sensitive-scope review is platform-level for Runwisely) ✅, free ✅ (1M req/day) | **Broken** — OAuth-only |
| Vendor manager, Booking scheduler | Square over Clover/Toast | OAuth ✅, no gate found ✅, free (no API fee) ✅ | **Works** — Square has a pasteable token |
| Inventory, Fulfillment/logistics | Shopify (custom-app token) + EasyPost | Shopify: self-serve token, no review ✅; EasyPost: API key, no gate, 3,000 free labels/mo ✅ | **Works** — both are pasteable |
| Build agent, QA/smoke-test agent, Deploy coordinator | GitHub (private App install) | OAuth-style consent ✅, no review for private install ✅, free ✅ | **Broken as specced** — needs a real GitHub App install flow, not a pasted key |
| Onboarding (Discord path) | Discord | Bot-token install (consent-screen pattern) ✅, no gate at this scale ✅, free ✅ | **Works** — bot tokens are themselves pasteable secrets |
| Onboarding (email path) | Resend | Same as Email marketing above | **Works** |

---

## 3. Role registry — every sub-agent currently in `packages/templates`

One table per team (`teamHint`). `#` = number of templates (of 6) that include this sub-agent, as a rough signal of how universal it is. Brain reasons that deviate from §1's tier default are called out explicitly; a blank reason means "the tier default applies, nothing role-specific to say."

### Founder

| Sub-agent | # | Brain | Hands | Effect? |
|---|---|---|---|---|
| Chief of Staff | 6/6 | T3 — strongest long-context synthesis across every team's summary | none | Draft-only (weekly plan + conflict flags; never dispatches) |

### CFO

| Sub-agent | # | Brain | Hands | Effect? |
|---|---|---|---|---|
| Invoicing | 5/6 | T2 — tone-matched drafting for reminders | Payments (own): Stripe or Square | Effect (create invoice, draft reminder) gated; **sending stays locked** regardless of tier |
| Expense categorization | 6/6 | T1 — cheapest available; batched nightly, highest volume in this team | Payments (own), read-only use here | Read-only — categorization never writes back |
| Cash-flow forecast | 6/6 | T2, escalates to T3 for the monthly deep-dive — careful numeric reasoning | none | Draft-only (reports) |
| Tax-deadline tracker | 5/6 | T1 — lookups only | none | Draft-only (checklist), **locked**: never files anything |
| Payroll prep | 1/6 (local) | T2 | Payroll: Gusto or Rippling, read-only | Draft-only, **locked always** — a real payroll run is never autonomous, full stop |
| Membership billing | 1/6 (physical-space) | T2 — same reasoning as Invoicing | Membership/booking platform: Mindbody or Wild Apricot | Effect (charge processing, receipts) |

### Delivery *(service template only — the business's own back-office finance is CFO above; this team is the actual paid work, `client-facing` scoped per ADR-002)*

| Sub-agent | # | Brain | Hands | Effect? |
|---|---|---|---|---|
| Service delivery | 1/6 | T2 | Client-facing systems (dynamic, per client) | Effect, **locked** — "this is the paid deliverable, never autonomous at MVP-0" per the template's own comment |
| Delivery QA | 1/6 | T2 — accuracy check before anything ships to a client | none | Draft-only (a check, not a send), **locked** |
| Delivery handoff | 1/6 | T1 — packaging/sending is mechanical once QA has passed | Client-facing systems (dynamic, per client) | Effect (send finished work) |

### CMO

| Sub-agent | # | Brain | Hands | Effect? |
|---|---|---|---|---|
| Social manager | 6/6 | T1 | Social — Meta family, TikTok, or X depending on template's platform mix | Effect (post) gated; **posting stays locked**, drafts earn autonomy |
| Content writer | 6/6 | T2; T3 for cornerstone/landing pieces — strongest sustained brand-voice prose | Social — X (only for the SaaS build-in-public variant); otherwise none | Draft-only |
| Email marketing | 4/6 | T2 | Email sending: Resend/Postmark, or Newsletter/list: ConvertKit | Effect (send) gated; **sending stays locked**, drafts earn autonomy |
| SEO agent | 5/6 | T1 research + T2 recommendations | Local presence: Google Business Profile API (local/physical-space variants only) | Read-only (research/reports) |
| Ad-creative | 1/6 (content) | T2 — strong short-form ad-copy variants | none in the current templates (a real image/video creative tool, e.g. an image-gen API, is out of scope until a template actually routes to one) | Draft-only, **locked**: spend is never autonomous |

### Support

| Sub-agent | # | Brain | Hands | Effect? |
|---|---|---|---|---|
| Tier-1 triage | 6/6 | T1 — heaviest volume in the whole org, cheapest tier mandatory | Shared inbox: Front, Zendesk, or delegated Gmail/Outlook | Effect (reply) gated; known-answer replies earn autonomy, everything else stays draft |
| Escalation | 6/6 | T2 — nuance detection for angry/complex/legal-adjacent cases | none (reads the same shared inbox; doesn't need its own connection) | Draft-only, **locked always** — routes to a human, never resolves anything itself |
| Onboarding | 3/6 | T2 | Email sending or Social — chat community (Discord, content template) | Effect (send welcome sequence) gated |

### Sales *(service and content templates only)*

| Sub-agent | # | Brain | Hands | Effect? |
|---|---|---|---|---|
| Lead qualifier | 1/6 | T1 — batched scoring | CRM | Read+write (score, enrich) — eligible-early |
| Outreach drafter | 2/6 | T2 — personalization without the template smell | Email sending, or the CRM's own email-send if bundled | Effect, **locked always** — sending outreach is never autonomous |
| CRM hygiene | 2/6 | T1 | CRM | Read+write (log, update stage) |
| Proposal builder | 1/6 | T2; T3 for large deals | CRM | Effect, **locked** (sending) |

### Ops

| Sub-agent | # | Brain | Hands | Effect? |
|---|---|---|---|---|
| Scheduling | 2/6 | T1 | Calendar | Read+write |
| Vendor manager | 3/6 | T1 tracking / T2 comms (tier varies by template — see §note below) | POS (local/physical-space) or none (ecommerce) | Read (tracking) + effect (draft reorder comms), **ordering itself always locked** |
| Inventory | 2/6 | T1, batched | E-commerce platform (Shopify/Etsy) or POS | Read (levels), read+effect (reorder-point alerts eligible-early) |
| Fulfillment/logistics | 1/6 (ecommerce) | T1 | Shipping (EasyPost/Shippo) | Read (status), draft-only (delay comms) |
| Booking scheduler | 1/6 (physical-space) | T1 | Membership/booking platform | Read+write, conflict flagging |
| Membership tracking | 1/6 (physical-space) | T1 | Membership/booking platform | Read-only |
| Facility maintenance | 1/6 (physical-space) | T1 | none (logs are internal) | Read-only, flags only |
| Event coordinator | 1/6 (physical-space) | T1 | Calendar | Read+write, reminder sends |

*Note on Vendor manager's split tier:* `ecommerce.ts` tags the reorder-communications task T2; `local.ts` tags its equivalent T1. Both are correct as written (the copy differs — ecommerce drafts to external suppliers, local is often a quicker internal note — so the reasoning difference is real), but flagging the inconsistency here since a future consumer of this table keyed purely on `agentType` would need to pick one tier per sub-agent, not per task.

### Compliance *(service and physical-space templates; attaches to CFO/Ops rather than being a standalone team)*

| Sub-agent | # | Brain | Hands | Effect? |
|---|---|---|---|---|
| Compliance review (contracts/regulation) | 1/6 | T3 always — "exactly where cheap models are dangerous," per the template's own comment | none | Draft-only, **permanently locked**: flags for the human + the user's own lawyer/accountant, never advises autonomously |
| Safety & waivers | 1/6 | T3 always, same reasoning | none | Draft-only, **permanently locked**: flags for human + user's own insurer, `requiresProfessionalVerification: true` |

### People *(local and physical-space templates)*

| Sub-agent | # | Brain | Hands | Effect? |
|---|---|---|---|---|
| Job-post writer | 2/6 | T2 | none | Draft-only |
| Applicant summarizer | 2/6 | T1, batched | none | Draft-only, **assists screening, never auto-rejects — the human decides** (template comment, not just a UI convention) |

### Product/Dev *(SaaS template only, MVP-3 build branch)*

| Sub-agent | # | Brain | Hands | Effect? |
|---|---|---|---|---|
| Spec writer | 1/6 | T3 — frontier class | none | Draft-only |
| Build agent | 1/6 | T2 | GitHub | Effect (PR/branch write), **locked**: "code proposals only, zero production credentials" |
| QA/smoke-test agent | 1/6 | T2 | GitHub | Effect (test-run trigger), **locked** |
| Deploy coordinator | 1/6 | T1 — orchestration, not judgment | GitHub | Effect (staging deploy trigger only), **locked**: the human approves every production deploy, always |

---

## 4. What this doesn't cover yet

- **Ad-creative's actual image/video tool** (Higgsfield or equivalent, mentioned as an example in `docs/product/roles-and-api-key-guide.md` Part 2) isn't in any current template's `handsTool` field — nothing to register until a template actually routes to one.
- **Concrete OAuth scope strings** (e.g. Google Calendar's exact scope identifier) aren't enumerated per service — that's an implementation-time lookup against each provider's current docs, not something to freeze into a design doc that would drift the moment a provider changes their scope naming.
- **Per-tenant Hands credential rotation/expiry policy** is a vault concern (`packages/vault`), not a template concern — out of scope for this registry.
