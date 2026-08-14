# Runwisely — Automation Runtime Plan
**Charter → master prompt → per-agent prompts → continuous 24/7 execution**
*The missing third phase: making the company actually run — August 2026*

---

## 0. What exists, and what doesn't

**Built:** the trust core (router, vault, cost gate, approval queue), the extraction engine (idea → org chart), the product surface (onboarding, org chart, dashboard, BYOK connect, JIT Hands).

**Missing:** the runtime. Today an agent with a Brain key and Hands connected sits idle forever — there is no scheduler, no event listener, no webhook receiver, nothing that dispatches a task without a human click. The dashboard's "Agents active —" and "$0.00" are accurate, not placeholder bugs. No agent has ever run.

**This plan closes that gap.** Five layers, in dependency order.

---

## 1. The chain, end to end

```
User's business idea
  → Charter (compiled: idea, MVP definition, month-one goals, ceilings)
  → CEO master prompt (Charter installed as the CEO agent's system prompt)
  → cascade: each role lead receives the goals relevant to its team
  → cascade: each sub-agent receives its own operating prompt + cadence
  → SCHEDULER fires each sub-agent on its cadence
  → ROUTER dispatches → cost gate → agent runs → approval queue
  → approved effects execute via Hands
  → results feed the digest, the dashboard, and the CEO's weekly synthesis
  → CEO proposes changes → user approves → Charter updates → re-cascade
```

The loop closes. The Charter is the constitution; the cascade is how it becomes instructions; the scheduler is what makes it continuous.

---

## 2. Layer 1 — Prompt generation (Charter → every agent)

The user writes nothing. They approve.

**Charter compilation** (one platform-paid batch, same as extraction): sharpened idea → MVP definition → each role's mandate → month-one goals → budget ceilings. User edits inline, approves, hands it to the named CEO.

**Cascade generates three prompt tiers, deterministically from the Charter + org chart:**

| Tier | Contains | Regenerated when |
|---|---|---|
| **CEO master prompt** | Full Charter, all team mandates, synthesis + recommendation duties, hard constraint: recommender only, no dispatch pathway (T10) | Charter edited |
| **Role-lead prompt** | Team mandate, its sub-agents' scopes, escalation rules, its slice of month-one goals | Charter or team edited |
| **Sub-agent operating prompt** | Its specific task type, cadence, tone/brand context, tool scope, output contract, autonomy status, cost tier | Charter, agent rename, or autonomy change |

**Rules that make this safe:** prompts are composed by the router per dispatch (never editable at runtime by anything the agent reads — security-architecture.md §4/§5.1's immutable-prompt rule; corrected here from an earlier draft that miscited this as "ADR-011," which is actually about interview-question design and unrelated — see ADR-024); every prompt is versioned with the Charter version that produced it; the user can view any agent's prompt and override it, and an override is recorded as a deliberate deviation.

---

## 3. Layer 2 — The scheduler (what makes it 24/7)

Three trigger types, in build order:

**(a) Cadence triggers — build first.** Each sub-agent declares a natural cadence in its template metadata: expense categorization is nightly-batched, cash-flow forecast is weekly, tax-deadline tracker is monthly, support triage is event-driven. BullMQ already supports repeatable jobs natively — this is the smallest useful subset and it makes the product genuinely continuous on day one.

**(b) Event triggers — build second.** Webhooks from connected Hands: Stripe invoice overdue, email received, calendar event created, form submitted. Requires a webhook receiver in `apps/api`, per-tenant endpoint secrets, and signature verification per provider. **Treat every webhook payload as untrusted data, never instructions (T2)** — an inbound email is content to analyze, not a command.

**(c) Threshold triggers — build third.** A watched value crosses a limit (inventory below X, spend above Y, churn rate rising). Cheapest implementation is a scheduled check that reads and compares — no new infrastructure, just a cadence trigger with a condition.

**Cadence metadata is new template work:** every sub-agent across all seven templates needs `cadence`, `batchable`, and `triggerType` fields. Zero runtime cost, real authoring time.

---

## 4. Layer 3 — Task chains

Single tasks aren't enough: *detect overdue invoice → draft reminder → approval gate → send → log* is five steps.

Chains ride the existing **task object** (structured state travelling with the task — memory isolation never broken for a handoff). Each step names its agent, its effect, and whether it gates on approval.

**The hard question, answered explicitly:** a chain paused at an approval gate **persists, doesn't expire, and resumes on approval** — with a staleness check. If the triggering condition no longer holds when approval arrives (the invoice got paid), the chain aborts and tells the user why rather than sending a reminder for a settled invoice. Chains older than a configurable window (default 7 days) expire with a notification.

---

## 5. Layer 4 — Unattended execution under the existing safety model

This is where the 24/7 claim meets the approval architecture, and the honest answer matters more than the ambitious one.

| Timeline | What actually runs unattended |
|---|---|
| **Day one** | Read-only and internal work: categorization, tagging, monitoring, drafting, reports, forecasts. Everything with an external effect queues for approval. |
| **Week two–four** | Task types that have earned autonomy (N approvals, default 10) run unattended, with permanent spot-check sampling. Typically: expense categorization, ticket tagging, inventory alerts, draft generation. |
| **Month two+** | Broader earned autonomy across low-stakes external actions (e.g. status updates, canned support replies) if the user grants it. |
| **Never** | Money movement, high-stakes external sending, deploys, and anything compliance-flagged. Permanent deny-list — a million approvals still yields no offer. |

**Honest marketing line:** *"Works while you sleep — on the tasks you've approved it to handle."* Not "fully autonomous from day one." The deny-list is a feature to advertise, not a limitation to hide: it's the direct answer to the 33% of SMBs whose top AI barrier is data-security concerns and the 78% who don't trust AI unsupervised.

---

## 6. Layer 5 — Cost under continuous operation

Agents firing on schedules spend the user's key while nobody watches. Every existing guarantee must hold unattended:

- **Pre-flight ceiling check** on every scheduled dispatch, same fail-closed gate. Estimator down → task queues, never proceeds.
- **Ceiling hit at 3am** → all further dispatch pauses, the resumable-exhaustion record preserves completed work, and the user wakes to a clear notification: *what paused, why, what it would cost to resume.* Never a drained balance, never silent failure.
- **Batch by default.** Nightly-cadence agents batch their work into one call (50% Batch API discount, and concentrating calls is what makes prompt caching actually hit for sporadic SMB workloads).
- **Skip the call entirely** where a deterministic rule suffices — the biggest cost lever is not calling a model.
- **Daily spend digest** so continuous operation is visible, not a surprise at month end.
- **Runaway protection:** a per-agent circuit breaker trips on repeated failures or anomalous call volume, independent of the ceiling.

---

## 7. Cadence limits — protecting COGS per company

Continuous operation is what makes the product real, and it is also what makes our own costs variable for the first time. Every scheduled run writes ledger and audit rows, occupies worker time, and touches Redis — so **cadence density, not agent count, is what actually drives our cost per company.**

### Measured impact

| | Pre-runtime | Post-runtime |
|---|---|---|
| Platform COGS / active company / month | $2.39 – $5.09 | **$3.59 – $9.39** |
| Gross margin at $29 | 86–93% | **68–88%** |
| Gross margin at $79 | 92–95% | 88–95% |

The largest single addition is an always-on worker for the scheduler ($0.60–2.00), followed by Postgres growth from per-run ledger and audit rows ($0.25–1.00).

**The risk is concrete:** an unconstrained Founder-tier user who sets every sub-agent to hourly turns a ~$3.59 company into a double-digit one, on a $29 subscription. Cadence must be a metered dimension, not a free-text field.

### Cadence floors by tier

The minimum interval a sub-agent may be scheduled at:

| | **Founder $29** | **Operator $79** | **Agency $199** |
|---|---|---|---|
| Minimum cadence | **Daily** | **Hourly** | **15 minutes** |
| Scheduled runs / company / day (soft cap) | 50 | 300 | 1,000 |
| Event triggers (webhooks) | 200 / day | 2,000 / day | 10,000 / day |
| Task chains in flight | 20 | 200 | Unlimited |
| Batch window control | Fixed nightly | User-configurable | User-configurable |

Sub-agents whose template metadata declares a naturally faster cadence than the tier allows are automatically clamped to the tier floor, with the reason shown in the UI (*"Runs daily on Founder — hourly available on Operator"*). This is a visible upgrade path, not a silent degradation.

### Enforcement rules

1. **Clamp at schedule time, not run time.** A schedule that violates the tier floor is rejected when created, not silently dropped later — the user always knows their real cadence.
2. **Soft caps degrade, they don't break.** Exceeding the daily run cap queues the overflow to the next window rather than failing it, with a notification. Repeated overflow triggers an upgrade prompt.
3. **Event triggers get their own ceiling.** Webhooks are the one path a third party can drive our costs — a misconfigured Stripe webhook could fire thousands of times. Per-tenant rate limits are mandatory, and the existing per-agent circuit breaker trips on anomalous volume independently of any cap.
4. **Batching is default and non-optional on Founder.** Nightly-cadence agents batch into a single call. This protects both our COGS and the user's BYOK spend, and it's why the user's own AI cost stays near $3/month even running continuously.
5. **Idle companies cost near-zero.** No scheduled work means no worker time and no ledger writes. Only *active* companies carry the runtime cost — worth reflecting in any billing model that ever meters usage.
6. **Chain depth and retry budgets are bounded per tier.** A runaway chain retrying indefinitely is a cost leak with no user benefit; retries are capped and exhaustion pauses rather than loops.

### Instrumentation, from day one of R3

We cannot price what we cannot see. The scheduler must emit, per tenant per day: scheduled runs executed, event triggers received, chain steps completed, ledger rows written, and worker seconds consumed. That feeds an internal COGS-per-company view so the tier floors above can be corrected against real data rather than these estimates — which are modelled, not measured, and should be treated as a starting hypothesis.

**Standing rule:** if median COGS on any tier exceeds 20% of that tier's price, the cadence floors are wrong and get revised before the pricing does.

---

## 8. Build order

| Phase | Ships | Why this order |
|---|---|---|
| **R1 — Cadence metadata** | `cadence`/`batchable`/`triggerType` on every sub-agent across all seven templates | Pure authoring, zero runtime risk, unblocks everything else |
| **R2 — Charter + cascade** | Charter compiler, editor, handoff ceremony, three-tier prompt generation, versioning | The prompts must exist before anything can run them |
| **R3 — Scheduler (cadence only)** | BullMQ repeatable jobs, per-tenant scheduling, pre-flight cost gate, pause-on-exhaustion | The smallest thing that makes the product genuinely continuous |
| **R4 — Digest + activity** | Daily digest by agent name, real activity feed, spend visibility | Continuous operation must be observable or it's untrustworthy |
| **R5 — Task chains** | Multi-step sequences, mid-chain approval gates, staleness checks, expiry | Unlocks the workflows people actually describe |
| **R6 — Event triggers** | Webhook receiver, per-provider signature verification, untrusted-payload handling | Highest value, highest security surface — after the safe path is proven |
| **R7 — Threshold triggers** | Watched values with conditions | Cheapest, built on R3 |

**R1–R4 is the minimum viable automation runtime.** At the end of R4, a user approves a Charter and their company runs on schedules, safely, visibly, with earned autonomy — without them clicking anything.

---

## 9. What this makes Runwisely

n8n asks the user to design the automation on a canvas. Runwisely derives what needs automating from the business idea, assembles the org that does it, writes every agent's instructions, and runs them continuously under spending caps and approval rules the user controls.

**The moat is the derivation. The runtime is what makes the derivation worth anything.** Neither half is a product alone.
