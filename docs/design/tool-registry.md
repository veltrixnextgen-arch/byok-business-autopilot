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
