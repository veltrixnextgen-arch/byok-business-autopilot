# Runwisely — System Architecture
**What's built, how the pieces fit together, and where the boundaries are**

> **Generated from repo state on `feat/google-calendar-oauth-connect`** (2026-08-12, through merged
> PRs #97–#100 plus this branch's own PR 2B — four PRs past the prior snapshot at commit `dc20075`).
> This document is a snapshot, not a design doc — every diagram
> and table below traces to code, migrations, or merged PRs as of that commit. It **will go stale** as
> the system changes; regenerate it after any material architecture change (a new package, a new
> deployable, a new migration, a trust-core redesign) rather than hand-patching it indefinitely.
> **This is now a required step whenever a PR touches trust-core, the data model, or the product
> flow — see `docs/TRACKING.md`'s Phase B working rule 12.** Companion to
> [`security-architecture.md`](./security-architecture.md), which owns the threat model and key
> lifecycle in depth — this document owns the shape of the system as a whole.

---

## 1. What the product does

A visitor types their business idea into the landing page. If they sign up, an interview collects a
handful of structured answers, a platform-funded extraction batch turns that into an org chart of
teams and sub-agents (**Brains** = the LLM reasoning, **Hands** = the external service APIs an agent
can act through), and from there the business runs on Runwisely's own infrastructure — every AI call
passes through a cost gate and, for anything consequential, a human approval queue.

- **Idea → org chart.** Interview answers get matched against six business templates (ecommerce,
  service, SaaS, content, local, physical-space) and extracted into teams, sub-agents, and tasks.
- **BYOK, enforced.** Every Brain key is per-role, every Hands key is per-sub-agent-and-capability,
  envelope encrypted, decrypted just-in-time into a self-zeroing handle, never logged.
- **Spend can't surprise you.** A fail-closed pre-call gate, a per-tenant durable ceiling, and a
  provider-side cap are three independent walls between the product and a runaway bill.

---

## 2. Deployment architecture

Two deployables, one shared Postgres. `apps/web` is a TanStack Start React app on Vercel;
`apps/api` is a Hono server on Railway. Staging deploys are tag-triggered (`v*.*.*-staging`) and
gated behind the full CI suite.

```mermaid
flowchart TB
    User["Business owner\n(browser)"]

    subgraph VERCEL["Vercel"]
        WEB["apps/web\nTanStack Start · React 19 SSR"]
    end

    subgraph RAILWAY["Railway"]
        API["apps/api\nHono"]
        PG[("Postgres\nRLS-scoped, per-tenant")]
    end

    ANTHROPIC["Anthropic API\nplatform key — onboarding extraction only"]
    PROVIDER["Brain/Hands providers\nuser's own BYOK keys — post-onboarding agent runs"]

    User -- HTTPS --> WEB
    WEB -- "fetch, credentialed cookie\nhc<AppType> typed client" --> API
    API --> PG
    API -- "extraction batch\n(pre-org, ADR-003)" --> ANTHROPIC
    API -. "Router -> Vault -> Executor\n(post-org, BYOK)" .-> PROVIDER
```

**Why two separate AI-call paths.** Onboarding extraction (the interview → org chart step) happens
*before* a tenant exists, so it runs on a capped platform key (ADR-003) — a bot signing up costs the
platform cents, never dollars. Every AI call *after* the org chart exists runs on the tenant's own
key, pulled from the vault per call and gated by the same cost ceiling, now scoped to that tenant
specifically.

**Deploy pipeline note:** the Railway project has more than one service — Railway's GitHub
integration auto-detects one per `package.json` it finds in the monorepo, which is why services like
`@byok/router` (a library, not a deployable) sometimes appear in the Railway dashboard and fail
healthchecks if left running. `railway.json` at the repo root and `deploy-staging.yml`'s
`RAILWAY_SERVICE` env var both explicitly scope the real deploy to `@byok/api` only.

---

## 3. Product user flow

From a cold landing-page visit to a running dashboard. The idea itself survives sign-up — typed
before auth, persisted through it, and handed to the interview the moment a session exists.

```mermaid
flowchart LR
    A["Landing page\nHero + idea box"] -->|"idea persisted\n(localStorage)"| B{"Signed in?"}
    B -- No --> C["Sign up / Log in\nBetter Auth"]
    C --> D["Interview\n5 spine + branch + context Qs"]
    B -- Yes --> D
    D -->|answers| E["Extraction batch\nrunExtractionBatch.ts"]
    E -->|"CostGate: PROCEED"| F["Org chart generated\nteams · sub-agents · tasks\n(pre-org, keyed to userId)"]
    E -->|"CostGate: QUEUE / SKIP"| G["Plain-language retry\nmessage (#47)"]
    F --> OC["Org Chart screen"]
    OC -->|"org created (#38)"| CLAIM["claimLatestForTenant\nchart re-keyed userId -> tenantId"]
    CLAIM --> CONNECT["Connect screen (#15)\nBrain key + spend ceiling"]
    OC -->|"inline badge tap (#22)"| HANDS["Hands connect panel\npaste key or skip -> draft mode"]
    CONNECT --> H["Dashboard\nSpending Walls · activity"]
    HANDS -.-> H
    H --> J["Tasks\napproval queue"]
```

---

## 4. Trust core — how a task actually runs

This is the part with a human-review gate on every merge (ADR-012). A task enters through
`Router.submitTask` and passes through dedup, tagging, the cost gate, the executor, and the approval
queue — in that order, with no shortcuts.

```mermaid
flowchart TB
    T["RouterTask submitted"] --> DD["Dedup store\nidempotent replay by key"]
    DD --> TAG["Tag derivation"]
    TAG --> PRE["evaluateGateVerdict\n(pure, per-tenant pre-check ledger)"]
    PRE -->|PROCEED / DOWNGRADE| DRS["DurableReservationStore\nreserveAtomic — per-tenant, atomic"]
    PRE -->|QUEUE / SKIP| STOP1["Task queued / skipped\nnever reaches the executor"]
    DRS -->|durable check disagrees| STOP1
    DRS -->|approved| EXE["OpenMultiAgentExecutor\npre-flight checks every Hands tool's\nconnection before offering it (#22)"]
    EXE --> BKP["BrainKeyProvider\n(Vault) — tenantId + roleId (#15)"]
    BKP --> SH1["SecretHandle.use()\nplaintext, one call, then zeroed"]
    SH1 --> OMA["OpenMultiAgent.runAgent()"]
    OMA -->|tool call, only if connected| HTS["HandsToolSpec\nfiltered to this task's subAgentId,\nkey resolved at call time (#22)"]
    HTS --> HKP["HandsKeyProvider\n(Vault) — tenantId + subAgentId + capability"]
    HKP --> SH2["SecretHandle.use()\njust-in-time, zeroed after"]
    SH2 --> SVC["External Hands service call"]
    EXE -->|missing Hands tool| DRAFT["effect: undefined forced (#22)\ntask can only ever be a draft"]
    OMA --> RES["Result + cost"]
    DRAFT --> RES
    RES --> SETTLE["CostGate.settle()\ndurable + per-tenant ceiling (#47)"]
    SETTLE --> AQ["ApprovalQueue"]
    AQ -->|human / spot-check| DONE["Task completed"]
    AQ -->|earned autonomy| DONE
```

### Key packages in this path

| Package | Role | Notable pieces |
|---|---|---|
| `@byok/router` | Dispatch, dedup, ledger, tool-use executor | `Router` · `OpenMultiAgentExecutor` · `handsTool.ts` · dedup/ledger stores |
| `@byok/vault` | Envelope-encrypted key storage, JIT decryption | `Vault` · `SecretHandle` · `BrainKeyProvider` · `HandsKeyProvider` · `DekStore` |
| `@byok/cost-gate` | Fail-closed pre-call spend gate, per-tenant + durable | `CostGate` · `evaluateGateVerdict` · `DurableReservationStore` · `PostgresReservationStore` |
| `@byok/approval-queue` | Final human firewall before any effect fires | `ApprovalQueue` · `DurableAutonomyStore` · `EffectExecutor` · `denyList` |
| `@byok/agents` | Extraction pipeline + contracts | `extraction/pipeline.ts` · `templateSelect` · contracts (`Charter`, `OrgChart`) |

---

## 5. Security architecture (summary)

Five principles every trust-core design decision traces back to — full detail in
[`security-architecture.md`](./security-architecture.md).

1. **Fail closed.** Any safety component down or uncertain — estimator, validator, vault — work QUEUES.
2. **Least privilege, everywhere.** Every agent/service/key has the minimum scope its task needs, granted just-in-time.
3. **Isolation lives in the orchestration layer.** Tenants, agents, and tasks are separated by construction.
4. **A human approves everything irreversible.** Money movement, external sending, deploys, key operations never earn autonomy.
5. **Content is data, not instructions.** Anything an agent ingests can never rewrite what the agent is or does.

**Recently closed threat-model gaps:**

- **T8 — data exfiltration via Hands tools (#37).** Hands tools are now filtered to the running
  task's own sub-agent before the LLM ever sees them, on top of the vault's AAD scope-binding — a
  hijacked agent can't see, let alone call, another sub-agent's tool.
- **T4 — runaway spend (#47).** The cost ceiling is now a real per-tenant, durable cap — a fresh
  process after a restart or a concurrent replica can no longer re-open budget the durable store
  already recorded as spent.
- **T3 — cross-tenant Brain-key collision (#15).** The vault's Brain-key map was keyed only by
  `roleId`, with no tenant dimension — since role ids like `"cfo"` are the same short slug across
  every tenant's org chart, tenant B's `storeBrainKey` could silently overwrite tenant A's entry, and
  tenant A's next decrypt would hand back tenant B's key material. Fixed by nesting the map
  `tenantId -> roleId -> record`; `BrainKeyProvider`'s interface now requires `tenantId` on every
  call. Regression-tested directly (`packages/vault/src/vault.test.ts`, "cross-tenant isolation").
- **T3 — pooled-connection RLS leak (#38 fix, `fec0cef`).** A custom Postgres GUC's `SET LOCAL`
  doesn't reliably revert to `NULL` when a pooled connection is reused by a later, unrelated scope
  call — `withUserAndTenantScope` setting `app.tenant_id` could leak into a later `withUserScope`
  call sharing the same physical connection, keeping a just-claimed row visible through the
  pre-transfer `user_id` RLS branch. Fixed by having every scope function (`withTenantScope`,
  `withUserScope`, `withUserAndTenantScope`, `withInternalMetricsScope`) explicitly clear every
  `app.*` GUC it doesn't own, on every call, to a sentinel nil UUID that can never satisfy a real RLS
  policy. Regression-tested at both the unit level (`tenantContext.test.ts`, `userContext.test.ts` —
  assert the exact `set_config` calls) and against real Postgres (`signupExtractionBatches.itest.ts`'s
  "claim happy path" test, which is what originally caught this).
- **JIT Hands draft-mode guarantee, made real (#22).** `OrgChartScreen`'s inline connect badges
  mean a sub-agent's Hands tool can go from "declared" to "connected" at any time — the executor now
  pre-flight-checks every tool's connection before offering it to the LLM, and the router forces
  `effect: undefined` on submission if anything required was missing, regardless of what the caller
  originally requested. "Agents without connected Hands work in draft mode" (ADR-002) is now an
  enforced invariant, not just an onboarding-copy promise.

**Architecture gap — partially closed.** `apps/web`'s org-chart Hands badges (#22) originally offered
one generic "paste an API key" input to every service regardless of auth shape, which dead-ended on
every OAuth-only service (`docs/design/tool-registry.md` §2e). Fixed structurally: `packages/templates`'s
`handsAuth.ts` now classifies every `handsTool` as `"key"`, `"oauth-live"`, or `"oauth-pending"`, and
the badge renders a genuinely different affordance per class — a paste field, a real OAuth connect
link, or an honest draft-mode message, never a promise the UI can't keep. **Google Calendar (`Calendar`)
is the first `"oauth-live"` entry** — `apps/api`'s `/hands-oauth/google-calendar/{start,callback}`
routes (ADR-021) do a real HMAC-state-CSRF-protected authorization-code exchange, storing the result
through ADR-020's structured-credential vault path. Code-complete but currently inert in every
deployed environment: Google's app verification needs a real public domain and privacy policy
(`docs/design/google-oauth-verification-checklist.md`) neither exists yet, so `GOOGLE_OAUTH_CLIENT_ID`/
`SECRET` are unset and the route 404s "isn't connectable yet." Every other OAuth-only service (Meta/TikTok
social, Google Business, most booking/membership platforms) is still `"oauth-pending"` — same honest
message as before, no dead-end paste field.

**Isolation model — three nested rings:**

| Ring | Scope | Enforcement |
|---|---|---|
| 1 — Tenant | Row-level isolation at the data layer | Per-tenant DEKs, tenant ID on every queue job and audit row |
| 2 — Agent | Own immutable system prompt per dispatch | Own memory store, own Hands scopes, own Brain assignment |
| 3 — Task | Cross-team handoffs | Travel as a structured task object — the receiving agent never sees the sender's history |

---

## 6. Data model

Seven migrations so far. Auth/tenancy tables are Better-Auth-managed; trust-core state (reservations,
tasks, approvals) and the pre-org signup funnel are Runwisely's own.

```mermaid
erDiagram
    tenants ||--o{ tenant_members : has
    users ||--o{ tenant_members : belongs_to
    tenants ||--o{ cost_ledger_counters : "scopes (per level)"
    tenants ||--o{ cost_reservations : scopes
    tenants ||--o{ router_tasks : scopes
    tenants ||--o{ task_ledger_entries : scopes
    tenants ||--o{ approval_queue_items : scopes
    tenants ||--o{ autonomy_counters : scopes
    users ||--o{ signup_extraction_batches : "creates (pre-org)"
    tenants ||--o{ signup_extraction_batches : "claims (#38, nullable tenant_id)"
    users ||--o{ signup_funnel_events : emits
    users ||--o{ signup_feedback : submits
```

| Migration | Adds |
|---|---|
| `0001_init` | Core tenancy — `tenants`, `users`, `tenant_members` |
| `0002_durable_storage` | Trust-core durable state — `cost_ledger_counters`, `cost_reservations`, `router_tasks`, `task_ledger_entries`, `approval_queue_items`, `autonomy_counters`, `paused_batches`, `audit_log` |
| `0003_better_auth` | Better Auth's own schema — `account`, `session`, `organization`, `member`, `invitation`, `two_factor`, `verification` |
| `0004_signup_extraction_batches` | `signup_extraction_batches` — the pre-org idea → org-chart pipeline's own record |
| `0005_signup_metrics` | `signup_funnel_events`, `signup_feedback` — funnel analytics + post-signup feedback |
| `0006_signup_extraction_batch_tenant_transfer` | Nullable `tenant_id` on `signup_extraction_batches`; replaces the `user_id`-only RLS policy with three branches (unclaimed rows stay `user_id`-visible, claimed rows become tenant-visible and close the `user_id` path, `internal_metrics` exception preserved); unique index enforcing one claimed chart per tenant (#38) |
| `0007_tenant_ceiling` | `tenants.monthly_ceiling_usd` — the durable per-tenant spend-ceiling override `CostGate`'s resolver now consults; `NULL` means "use the platform default," never coalesced to `$0` (#15) |

Row-level security enforces tenant isolation at the Postgres layer itself
(`packages/db/src/verifyRlsIsolation.ts`), not just in application code — Ring 1 of the isolation
model, made structural. Every scope-setting function (`packages/db/src/tenantContext.ts`,
`userContext.ts`) now explicitly clears every `app.*` GUC it doesn't own on each call, not just sets
the one it does — a pooled connection cannot leak a prior call's scope into the next one (fixed for
real in `fec0cef`, see §5).

---

## 7. Frontend — apps/web

One TanStack Start app carrying both the public marketing site and the authenticated product — a
shared design-token system (`tokens.css`) and a shared `IdeaForm` component connect the two.

**Marketing site** (`components/landing/`): Hero + HeroPanel · ScrollSequence (scroll-scrubbed
narrative) · InteractivePreview · ProductStory · ByokExplainer · ValueComparison · ControlSafety ·
SpendingWalls · DashboardPreview · HowItWorksPage · PricingPage · NetworkIllustration (shared SVG,
reused across hero + app) · LandingNav / LandingFooter.

**App screens** (`components/`): AuthShell (sign-in/up) · SignupScreen · OnboardingScreen ·
InterviewScreen · OrgChartScreen (now with inline `HandsConnectPanel` badges per agent, #22) ·
ConnectScreen (Brain-provider key + spend ceiling, #15) · DashboardScreen (BYOK CTA until a Brain key
is connected) · TaskListScreen — each with its own test file and a matching route under `routes/`.

**Routes** (`apps/web/src/routes/`): `index` (landing) · `login` · `signup` · `onboarding` ·
`interview` · `org-chart` · `dashboard` · `tasks` · `how-it-works` · `pricing` · `styleguide` — plus
a shared `__root` shell.

Bundle budget: initial JS stays under 150KB gzipped, enforced in CI (`check-bundle-size.mjs`) after a
real production `vite build`.

---

## 8. Monorepo package map

🔒 = CODEOWNERS-locked (trust-core, human-review-gated per ADR-012).

| Path | What it is |
|---|---|
| `apps/web` | TanStack Start frontend — marketing site + authenticated app |
| `apps/api` 🔒 | Hono API — routes, auth middleware, tenant/user scoping, trust-core wiring |
| `apps/router` 🔒 | Task dispatch: dedup → tag → cost-gate → executor → approval-queue |
| `packages/vault` 🔒 | Envelope-encrypted Brain/Hands key storage, audit log, `SecretHandle` |
| `packages/cost-gate` 🔒 | Fail-closed spend gate — estimator, ceilings, durable per-tenant reservations |
| `packages/approval-queue` 🔒 | Human-review firewall, autonomy engine, effect executor, deny list |
| `packages/db` 🔒 | Postgres connection, migrations, RLS verification, durable stores |
| `packages/agents` | Extraction pipeline (interview → org chart) + shared Charter/OrgChart contracts |
| `packages/templates` | Six business templates — ecommerce, service, SaaS, content, local, physical-space |
| `packages/auth` | Better Auth configuration, step-up (MFA) policy |
| `packages/jobs` | Background job queue/worker scaffolding |

---

## 9. CI / release pipeline

```mermaid
flowchart LR
    PR["Pull request opened"] --> CI{"CI checks"}
    CI --> C1["Install · typecheck · test · lint"]
    CI --> C2["Integration tests (Postgres)"]
    CI --> C3["Secret scan (gitleaks)"]
    CI --> C4["Dependency audit"]
    CI --> C5["Trust-core attestation\n(required for locked paths)"]
    C1 & C2 & C3 & C4 & C5 --> M["Human merges"]
    M --> TAG["Tag v*.*.*-staging"]
    TAG --> DEP["deploy-staging.yml"]
    DEP --> RW["Railway: apps/api"]
    DEP --> VC["Vercel: apps/web"]
    RW & VC --> SMOKE["Smoke checks"]
```

`Trust-core attestation` is ADR-012's replacement for a normal approving review — unsatisfiable with
a single-account repo. It scans the PR description for a literal `TRUST-CORE REVIEWED: <maintainer>`
line whenever a trust-core path changed, and only the maintainer ever writes it.

---

## 10. Status at this snapshot

Most recent work first — see each package's own CHANGELOG-equivalent (PR history) for full detail.

- **PR 2B (this snapshot)** — Google Calendar Hands OAuth connect, real end to end. `apps/api`'s
  `/hands-oauth/google-calendar/{start,callback}` routes (ADR-021), `handsAuth.ts`'s three-way
  `"key" | "oauth-live" | "oauth-pending"` classification replacing the old two-way one, Calendar's
  badge now a genuine connect link. Code-complete, inert pending a real domain for Google's app
  verification — `GOOGLE_OAUTH_CLIENT_ID`/`SECRET` unset in every environment today.
- **PR #99 (merged)** — OAuth Hands credential refresh infrastructure (ADR-020): structured
  `credentialKind: "oauth"` storage, provider-agnostic `HandsCredentialRefresher`, single-flight
  refresh (verified necessary by reading `@open-multi-agent/core`'s source, not assumed), fail-closed
  on every refresh-failure path. Also closed a real gap found while verifying before building: a
  Hands tool connected at pre-flight but failing live never reached `missingHands` — fixed via
  `handsTool.ts`'s new `onLiveFailure` callback.
- **PR #98 (merged)** — Fixed §5's then-gap directly: `HandsConnectPanel`'s single paste-a-key input
  dead-ended on every OAuth-only service. `handsAuth.ts` (new) classifies every `handsTool`, driving
  which affordance the badge shows — registry-backed, not a hardcoded component list.
- **PR #97 (merged)** — This document's previous regen (through #96), plus `docs/TRACKING.md` rule 12
  requiring regeneration on any trust-core/data-model/flow-changing PR.
- **PR #96 (merged)** — Just-in-time Hands granting flow: draft mode + JIT connect. Fixes #22. Vault
  gained a `(tenantId, subAgentId, capabilityScope)` index; the executor pre-flight-checks every
  Hands tool's connection before offering it to the LLM; the router forces `effect: undefined` on
  submission if anything required is missing — draft mode is now enforced, not just promised. Ships
  the inline connect badges on the org chart, which currently only support pasted API keys (see §5's
  known architecture gap and `docs/design/tool-registry.md` §2e/§2f/§2g).
- **PR #95 (merged)** — BYOK connect flow: per-tenant Brain keys, spend ceiling, connect screen.
  Fixes #15. Migration 0007 (`tenants.monthly_ceiling_usd`). Found and fixed a real cross-tenant
  Brain-key collision in the vault along the way (§5). v1 scope: one Brain provider for the whole
  company, applied across every team id.
- **PR #94 (merged)** — Org-chart → tenant handoff, triggered at org creation. Fixes #38. Migration
  0006. Surfaced and fixed a real cross-request RLS leak from pooled-connection GUC reuse (§5),
  caught by this PR's own integration test against real Postgres.
- **PR #93 (merged)** — Added this document (`docs/architecture/system-architecture.md`) as a
  repo-wide architecture snapshot, now itself the subject of the regen this update performs.
- **PR #92 (merged)** — Per-tenant, durable cost ceiling. `CostGate` now scopes every ceiling to a
  `tenantId` and enforces it through the previously-unwired `DurableReservationStore`. Fixes #47.
- **PR #91 (merged)** — Verified Hands connection registry. `docs/design/tool-registry.md` extended
  against every provider's current docs — auth, gating, capability, cost, reliability, cited.
  Extended again alongside this regen with rate-limit coverage and a per-sub-agent OAuth-ranked
  recommendation (§2f/§2g), prompted by #96's connect-badge UI gap.
- **PR #90 (merged)** — Tool-use-capable executor + Hands/Brain key providers. Fixes #37.
- **PR #87–89 (merged)** — Final UI fidelity pass against the reference design.
- **Not yet started** — issue #13 (per-role Brain key picker, today's connect flow is one provider
  company-wide); Meta Graph API OAuth (checklist ready at `docs/design/meta-app-review-checklist.md`,
  §2g's second-ranked target — code not built); the two `railway variable set` lines that activate
  Google Calendar OAuth once a real domain and client credentials exist (ADR-021).
