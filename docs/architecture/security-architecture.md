# Runwisely — Security Architecture
**Threat model · key lifecycle · isolation · injection defense · spend security · deploy security**
*Companion to Master Plan v2 and System Architecture v6 — July 2026*

**Why this document is existential, not compliance theater:** users hand us the two most sensitive things they have — their API keys (a direct line to their money) and their business's inner workings (finances, customers, unlaunched ideas). One key leak or one cross-tenant data bleed ends the company. Security here is the product promise "your keys, your business, no surprises" made enforceable.

---

## 1. Five Principles (every design decision traces to one)

1. **Fail closed.** When any safety component is down or uncertain — cost estimator, validator, vault — work QUEUES. Nothing ever proceeds blind.
2. **Least privilege, everywhere.** Every agent, service, and key has the minimum scope its task needs — and scopes are granted just-in-time, not up front.
3. **Isolation lives in the orchestration layer.** Tenants, agents, and tasks are separated by our system's construction, never by trusting a model to behave.
4. **A human approves everything irreversible.** Money movement, external sending, production deploys, and key operations never earn autonomy. Ever.
5. **Content is data, not instructions.** Anything an agent ingests — emails, tickets, web pages, documents — can never rewrite what the agent is or does.

---

## 2. Threat Model

| # | Threat | Vector | Mitigations (layered) |
|---|---|---|---|
| T1 | **User API key theft** | DB breach, log leak, XSS, insider | Envelope encryption (§3); keys never in logs/analytics/client/LLM context; memory-only decryption with per-call TTL; masked fingerprints everywhere in UI; automated secret-scan on log pipelines; one-tap revoke |
| T2 | **Prompt injection** — a malicious email/ticket/webpage hijacks an agent | Any ingested content | Immutable role prompts per dispatch; ingested content wrapped as data (§5); tool scoping caps blast radius (poisoned support email physically cannot reach the bank feed); approval queue as the final firewall — hijacked *output* still can't act without a human |
| T3 | **Cross-tenant data leak** | Query bug, cache bleed, shared memory | Row-level tenant isolation enforced at the data layer by construction; per-tenant encryption keys; per-agent memory stores with no cross-agent reads; tenant ID threaded through every queue job and audit entry |
| T4 | **Runaway spend on the user's card** | Agent loop, retry storm, estimator bug | Three independent walls: fail-closed pre-call gate → user's in-app ceiling → provider-side cap we walk them through setting; per-task-type sub-ceilings; circuit breaker trips looping agents; anomaly detection on call-volume spikes |
| T5 | **Malicious/broken deploy** (MVP-3) | Build-agent error, injected dependency | Sandbox with zero production credentials; secret + dependency scans; staging-only path; plain-language summary + explicit approval; auto-rollback; hard resource ceilings; user-owned repo = independent audit trail |
| T6 | **Account takeover** | Credential stuffing, session theft | Better Auth with MFA offered at signup and **required** before key operations, ceiling changes, autonomy grants, or deploy approvals; session revocation; new-device alerts |
| T7 | **AI-builder contamination** — Emergent (or any generator) introduces a flaw into the trust core | Build pipeline | CODEOWNERS lock: router, vault, cost gate, approval queue accept no merge without human review; CI secret/dependency scans on every PR; trust-core directories are human + Claude Code territory only |
| T8 | **Data exfiltration via Hands tools** | Compromised or over-scoped service API | Hands keys scoped per sub-agent and per capability (Stripe = read-only; GitHub = single repo); an agent can never enumerate or borrow another agent's Hands; all Hands calls audited |
| T9 | **Onboarding abuse** — burning our platform-key CAC budget | Bot signups | Hard per-signup inference cap (cents); rate limiting; email verification before extraction runs; anomaly detection on signup patterns |
| T10 | **CEO-agent overreach** | Design failure, prompt drift | Architectural, not behavioral, control: the CEO's outputs can ONLY enter the approval queue — it has no dispatch, spend, send, or deploy pathway to abuse, no matter what its prompt becomes |

---

## 3. Key Lifecycle (Brains and Hands)

**Acquisition** → guided walkthrough; user pastes into the connect screen only (never chat/email — we say so explicitly). **Validation** → one fraction-of-a-cent test call; on success the UI shows only a masked fingerprint (`sk-...4f2a`) forever after. **Storage** → envelope encryption: each key encrypted with a per-tenant data key (DEK), each DEK encrypted by the KMS master key; plaintext exists nowhere at rest. **Runtime** → only the router's service account can request decryption; plaintext lives in agent-runtime memory for the duration of the call batch, then is discarded; it is never written to disk, logs, traces, or model context. **Hands specifics** → each Hands key is bound to one sub-agent and one capability scope at grant time; granting is just-in-time (the agent asks when a task first needs it). **Rotation** → users can replace a key anytime; we prompt annually. **Revocation** → one tap: vault entry purged, all queued tasks referencing it cancelled, affected agents pause to draft mode, user notified of exactly what paused. **Deletion** → account deletion purges all keys, memories, and Charter versions within the stated window; audit log retains only non-sensitive event metadata.

---

## 4. Isolation Model (three nested rings)

**Ring 1 — Tenant.** Row-level isolation at the data layer; per-tenant DEKs; tenant ID on every queue job, cache entry, and audit row. Cross-tenant queries are impossible by construction, not by discipline.
**Ring 2 — Agent.** Own system prompt (immutable per dispatch), own memory store (no cross-agent reads — role merges/splits archive old memories and seed the new role with a summarized digest only), own Hands scopes, own Brain assignment and tier.
**Ring 3 — Task.** Cross-team handoffs travel as a shared **task object** — structured state that moves with the task. Memory isolation is never broken for a handoff; the receiving agent sees the task object, never the sender's history.

---

## 5. Prompt-Injection Defense in Depth

1. **Immutable role prompts:** the agent's system prompt is composed by the router per dispatch from the versioned Charter + role definition; nothing an agent reads can modify it.
2. **Content-as-data envelope:** every piece of ingested content (email bodies, tickets, fetched pages, uploaded docs) is wrapped and framed as material to analyze, never instructions to follow; instructions found inside content are surfaced to the user as findings, not executed.
3. **Scope as blast radius:** even a fully hijacked agent can only touch its own narrow Hands scope — the Marketing agent has no pathway to payments, the Support agent none to the repo.
4. **The approval queue is the final firewall:** injected content can, at absolute worst, produce a bad *proposal* — which a human sees, in plain language, before anything happens.
5. **The CEO rule (T10):** the highest-context agent is also the least-empowered — recommendation-only by architecture.

---

## 6. Spend Security (the "no surprise bills" promise, enforced)

Three independent walls, any one of which stops a runaway: **(1)** the fail-closed pre-call gate (estimate → over-ceiling means downgrade/queue/skip; estimator down means QUEUE); **(2)** the user's in-app monthly ceiling with per-task-type sub-ceilings (the dashboard names the exact line item eating budget); **(3)** the provider-side cap set during onboarding — the backstop that survives even a total failure of our platform. Supporting controls: circuit breaker on looping agents; retry policies that never retry on budget-exhaustion; call-volume anomaly alerts; batch-by-default for non-urgent work; the platform's own onboarding inference capped per signup (T9). **Design stance:** under BYOK a bug spends the *user's* money — so the gate gets the same hard-stop engineering as production infrastructure, not alert-and-hope.

---

## 7. Deploy Pipeline Security (MVP-3)

Sandbox (zero production credentials — the build agent can only propose) → automated checks (build, generated smoke tests, secret-leak scan, dependency vulnerability scan; fail any = never reaches staging) → staging preview URL, always → plain-language change summary + explicit user approval (no silent production deploys, ever) → production with auto-rollback armed on error-rate threshold, hard resource ceilings (max instances, max DB size — a runaway bug hits a wall, not a bill), and scheduled backups with **periodically tested restores**. Every change is a real commit in the **user's own GitHub repo** plus a deploy log — timestamped, attributable, reversible, and independently auditable by the user even if they leave us.

---

## 8. Platform Security Operations

- **Trust-core protection:** CODEOWNERS on `/router`, `/vault`, `/cost-gate`, `/approval-queue`; no AI-generated merge without human review; CI runs secret + dependency scans on every PR; deploys from signed tags only.
- **Logging hygiene:** structured logs with an allowlist schema — keys, key fragments, and raw customer content are unloggable by construction; secret-scan runs on log pipelines as well as commits.
- **Monitoring & response:** per-sub-agent health (success rate, latency, cost trend); vault-access and failed-decryption alerting; a written incident-response runbook with user notification commitments for any key- or data-affecting event; every run replayable from the audit log so incidents are diagnosed from evidence, not guesses.
- **User data rights from day one:** export everything (Charter versions, agent outputs, cost history) and delete everything, self-serve. GDPR-basics posture at launch; SOC 2 Type I targeted post-MVP-2 revenue (Agency-tier buyers will ask).

---

## 9. What We Tell Users (security as product copy)

Every mechanism above surfaces as one of five plain sentences the product repeats: *Your keys are encrypted and only your agents can use them — revoke anytime.* · *Nothing your agents read can change what they are.* · *Nothing irreversible happens without your tap.* · *Three separate walls stand between you and a surprise bill.* · *Your code and your data leave with you.* If a feature can't be honestly described by one of these sentences, it doesn't ship.
