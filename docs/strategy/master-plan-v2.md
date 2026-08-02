# BYOK Business Autopilot — Master Plan v2
**Strategy · economics · build plan · MVP ladder — updated to the v2 flow**
*Supersedes Master Plan v1.0 — July 2026*

---

## 0. What changed from v1 (so every doc stays in sync)

| Change | Consequence |
|---|---|
| Managed-key trial **removed**; platform AI pays only for onboarding (extraction → chart → simulated day → Charter draft) | CAC per signup drops to cents; free-execution abuse risk eliminated; the onboarding cliff is now fought with the **simulated first day**, not free tasks |
| **Brains vs. Hands** tool model | Two key types in the vault with different scopes and lifecycles; Hands keys are collected just-in-time, never up front |
| Master prompt formalized as the **Company Charter** (versioned artifact, handoff ceremony) | The Charter is now a first-class data object: compiled by us, edited by the user, installed as the CEO's master prompt, re-cascaded on every edit |
| **CEO agent = recommender, never executor** | Hard architectural rule: CEO output can only enter the approval queue; only the router dispatches work |
| Named agents ("Alex · CFO" — name never without title) | Names propagate through digest, queue, dashboard, and logs |
| MVP-1 kill criterion updated | Was "BYOK graduation from trial"; now **"key-connection rate after the simulated day"** (target ≥35% of users who complete the org chart) |

---

## 1. The Idea (one paragraph, current)

A user describes their business idea once. On the platform's own dime (a capped few cents), the system reverse-engineers the idea **bottom-up** — every granular task → one sub-agent per task type → teams → the role assembled last to lead each team — presents the org chart as an animation of their own company assembling, lets them **name** every agent, pick each role's **Brain** (LLM provider, smart-defaulted) and see which **Hands** (service APIs) each team will later request, then shows them a **simulated first day** of their company running. From there everything is BYOK: guided key setup, three independent spend walls, then the **Company Charter** (idea → MVP definition → every role's tasks → goals) is reviewed, approved, and ceremonially handed to their named CEO agent, whose master prompt it becomes. Automation goes live: agents work, everything lands in an approval queue, autonomy is earned per task type, the CEO synthesizes and recommends but can never execute, and if the idea needs software, a parallel build branch commits every change to the **user's own GitHub repo** behind a staged, human-approved deploy pipeline. The app the user lives in afterward is simply their **company dashboard, where their employees report every day** — at pass-through cost, with zero markup on intelligence.

## 2. Market & Competition (verified July 2026 — unchanged, summarized)

~$206.5B forecast 2026 agent-software spend (+139% YoY); ~137x non-developer agent adoption since Aug 2025; SMBs the largest sub-segment. Sintra: $39–97/mo, 250 credits on every tier, **no execution** (draft-only, users copy-paste), helpers stop at credit exhaustion. Lindy: pivoted early 2026, free plan dropped, $49.99–199.99, billing-surprise complaints dominate reviews (~1.7/5 Trustpilot, $550-overage reports), 3–10x "model tax," gated model choice. Dume: closest (execution + model choice) but still credit-markup, single assistant, no org structure. **White space intact:** nobody combines BYOK pass-through + real execution + bottom-up derived org + guided non-technical onboarding. Our two attack surfaces are the two loudest public complaint streams: Sintra's draft-only limit and Lindy's billing surprises.

## 3. Users, Cost, Pricing, Revenue (updated)

**Segments** unchanged: pre-launch founders → solo operators → micro-SMBs → agencies. Beachhead: 100 design-partner-quality paying users.

**Platform COGS:** ~$1.70–4.35/active user/month (hosting, KMS, notifications, payments, support); **AI inference $0** post-onboarding. **Onboarding CAC:** one capped batch (extraction + chart + simulated day + Charter draft) ≈ **$0.03–0.10 per signup** — down from the v1 trial's $0.50–1.50. Gross margin at price: ~85–92%.

**Tiers:** Free $0 (chart + simulated day + Charter + 1 role with full manual review) · Starter $12 (3 roles) · Pro $29 (unlimited roles, earned autonomy, batching, skip-the-call) · Agency $79 (multi-client). The free tier now costs us cents flat, so it can be genuinely unlimited in signups — the org chart is the viral asset.

**Year-1 revenue scenarios** (assumptions explicit: 4/7/10% free→paid, ~$24 blended ARPU, 6/4.5/3% monthly churn): Conservative ~$43K ARR run-rate · Base ~$173K · Optimistic ~$634K. Year 1 buys template quality + autonomy data + testimonials; revenue inflects Year 2 with Agency + the deploy layer.

## 4. Repositories (verified) & Build Plan

**Fork:** `open-multi-agent/open-multi-agent` (TS, model-agnostic DAG orchestration; `planOnly` ≈ our Charter/chart approval gate; `maxCostBudget`/`estimateCost` ≈ our cost gate; built-in retry/FAILED states) — depend on it via the published **`@open-multi-agent/core`** npm package. ⚠️ The bare `open-multi-agent` package on npm is an unrelated project by a different author — do not install it. — and **SaaSWeave** (multi-tenant TS monorepo: TanStack Start, Hono, oRPC, Drizzle, Better Auth, BullMQ+Redis). **Read:** claude-flow, AY Automate starter.

**Phase A (Claude Code, wk 1–4):** shell from SaaSWeave; router service wrapping open-multi-agent (tagging, task-object handoff, dedup, per-sub-agent ledger); the four trust-core components built by hand — **key vault** (Brains + Hands key types), **fail-closed cost gate**, **approval queue + earned autonomy**, **Task Extraction Engine** (5 business-type templates + customize; also emits the simulated-day script and Charter draft from the same batch). CI from day one: build, tests, secret scan, dependency audit, protected main, deploy from tags.
**Phase B (Claude Code, wk 3–6):** the commodity surface — onboarding screens, org-chart animation player, role-card deck, approval-queue UI, Charter editor, dashboard, Stripe billing, notifications — built one branch/one PR per step on top of Phase A's shell (ADR-010). **Containment fence applies to every code generator, not just trust-core:** CODEOWNERS review, the ADR-009 lint boundary, branch protection, and required CI apply the same way here as everywhere else in the repo. External design tools may inform the visual design but produce visual references only — no code from them enters the repo directly.
**Phase C (wk 6–10):** staging pipeline per security architecture; **Capacitor** wrap for iOS/Android — push notifications = approval requests ("approve your CFO's work from your phone").

## 5. MVP Ladder (updated to v2)

| MVP | Ships | Kill/advance criterion |
|---|---|---|
| **MVP-0** (wk 1–4) | Idea → interview → tasks → org-chart animation → named role cards → **simulated first day**. No keys, no execution. | Differentiation test: candle shop / freelance bookkeeper / unbuilt SaaS must produce visibly different charts. ≥70% of 20 testers say the chart taught them something. |
| **MVP-1** (wk 5–10) | BYOK key flow + spend walls + Charter compile/handoff + ONE role executing with full approval queue + per-sub-agent cost dashboard. | **≥35% of chart-completers connect a key** after the simulated day. If <20%, the free perceived value is insufficient — move Charter review before the key gate (pre-planned one-screen swap). |
| **MVP-2** (mo 3–5) | Multi-role, task-object handoffs, CEO recommendation loop, earned autonomy, just-in-time Hands, batching, skip-the-call, Agency workspaces. | Paying users; churn <6%/mo; ≥1 autonomous task type per active user; CEO recommendations get ≥30% approve rate (below that it's noise, retune). |
| **MVP-3** (mo 6+) | Parallel build branch: user-owned GitHub repo, staged deploys, full pipeline. | Gated entirely on MVP-2 paying traction. |

## 6. GTM & Metrics

Dogfood the launch: our own CMO team runs it (build-in-public, direct outreach to public Sintra/Lindy complaint threads, Product Hunt at MVP-2). Every generated org chart is shareable growth content. North stars per MVP as above; standing rule unchanged: **the router, the templates, and the autonomy data are the moat — anything not strengthening one of the three is scope creep.**

---
*Companions: `byok-userflow-v2-final.md` (the flow) · `byok-userflow-roles-and-api-key-guide.md` Parts 2–3 (role catalog, key guides) · `system-architecture-v6-technical.mermaid` (system architecture) · `byok-security-architecture.md` (security architecture).*
