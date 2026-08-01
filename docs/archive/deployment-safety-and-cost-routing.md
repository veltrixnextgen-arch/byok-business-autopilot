# Deployment Safety Layer + Cost Decision Layer

## Part 1: Reducing deployment risk — stacked, independent safeguards

No single safeguard gets you to "safe." What gets you close is layering several independent ones, so a failure in one is caught by the next. Here's the stack, in the order a change passes through it:

**1. Nothing touches production directly.** The build agent runs in an isolated sandbox with zero production credentials. It can only ever propose a change into the pipeline below — it physically cannot deploy anything itself.

**2. Automated pre-checks before anything ships anywhere.** Every change must pass: build/compile success, automated tests (even a minimal generated smoke test), a secret-leak scan (catches an API key accidentally committed to code), and a dependency vulnerability scan. Fails any of these → never reaches staging.

**3. Staging first, always.** Every change deploys to an isolated preview environment with its own URL — never production — where it can be checked before anyone decides whether it goes live.

**4. Plain-language change summary + human approval gate.** Before going live, the user sees "this update adds X, changes Y, touches these files" in plain English, not a code diff — and has to explicitly approve. No silent auto-deploy to production, ever, especially not on a user's first several deploys.

**5. Canary rollout for updates to something already live.** New version goes to a small slice of real traffic first (e.g., 5%). Error rates and latency are watched automatically; if they spike, the rollout halts before reaching everyone.

**6. Automatic rollback.** The previous working version is always one step away. An error-rate spike past a threshold triggers an automatic revert — the system doesn't wait for the user to notice and ask.

**7. Hard resource ceilings, not just alerts.** Auto-scaling limits are capped (max server instances, max database size) so a bug causing a runaway loop hits a wall instead of an unbounded cloud bill. This is a hard stop the user sets, not a warning they might miss.

**8. Tested backups.** Scheduled, automatic database backups — and the restore path is actually tested periodically, not assumed to work. An untested backup isn't a real safety net.

**9. Full audit trail.** Every change is a real Git commit plus a deploy log — timestamped, attributable, fully reversible. This is what makes the whole stack meaningfully safe: even in the failure case, you're looking at a known, revertible state, never an unknown one.

Stacked together — sandboxed build, automated checks, staging, human approval, canary rollout, auto-rollback, hard cost ceilings, tested backups, full audit trail — the realistic failure mode left over is small and recoverable, which is what "99% safer" should actually mean here.

---

## Part 2: The credit/cost decision layer — keeping AI spend sharply low

The goal isn't "use the cheapest model always" (quality suffers) or "use the best model always" (cost explodes) — it's routing each task to the cheapest model that's actually capable of it, and avoiding redundant calls entirely wherever possible.

**1. Classify before routing.** Every incoming task is tagged by complexity/stakes before any model is chosen: simple lookup/categorization vs. content drafting vs. financial calculation vs. strategic reasoning vs. anything customer-facing at high stakes.

**2. Tiered routing by task type.**
| Tier | Model class | Used for |
|---|---|---|
| 1 — cheap/fast | Haiku-class, GPT-mini-class | Expense categorization, ticket tagging, simple lookups — high volume, low stakes |
| 2 — mid | Mid-size models | Drafting, summaries, medium-complexity reasoning |
| 3 — frontier | Full Claude/GPT/Gemini | Strategic decisions, complex financial analysis, high-stakes customer-facing content |

Default to Tier 1. Escalate to Tier 2/3 only when a confidence check fails, the model flags uncertainty, or the task is explicitly marked high-stakes — never escalate by default just because a "better" model exists.

**3. Cache and deduplicate.** The same or near-identical request (a repeated FAQ, a recurring categorization pattern) is served from cache instead of triggering a new paid call.

**4. Batch instead of firing one call per item.** Twenty expenses to categorize becomes one API call handling all twenty, not twenty separate calls — this alone can cut a meaningful share of per-call overhead.

**5. Trim context aggressively.** Send only what's needed for the task, not the full history every time. Summarize older context instead of resending it in full on every call.

**6. Per-task-type budget ceilings, not just per-role.** A role's overall spend cap isn't enough on its own — if one noisy task type (say, an overly chatty support flow) quietly eats the whole budget, the user needs to see *that specific* line item, not just "Support is near its cap."

**7. Cost preview before execution.** For anything non-trivial, the system estimates cost before firing the call and can automatically downgrade tier, queue, or skip if it would blow past the ceiling — this is the same pre-call-check principle from the earlier spend-cap design, applied per task instead of just per role.

**8. Sometimes the cheapest call is no call.** Usage analytics surface patterns back to the user: "your Support role spent 60% of its budget on repeated password-reset questions — add a canned response and skip the AI call entirely for these." The biggest cost reduction usually isn't a smarter model, it's not calling a model at all for something that doesn't need one.

**9. Keep the routing table current.** Provider pricing shifts over time (models get cheaper, new tiers launch) — the routing logic should re-check and re-optimize periodically rather than being hardcoded once at launch.

Together, these two layers do different jobs: Part 1 makes a bad deploy recoverable instead of catastrophic; Part 2 makes routine operation cheap by default so the spend cap rarely gets tested in the first place.

---

## Part 3: Prioritized cost-reduction checklist — ranked by effort-to-savings ratio

| # | Lever | Real savings | Effort | Applies to |
|---|---|---|---|---|
| 1 | **Prompt caching** on every agent's static system prompt/persona | Up to 90% off the cached portion; 50-80% typical in real agent workloads | Low — mostly automatic with providers, just keep dynamic content out of the cached prefix | Every agent, every call |
| 2 | **Model tiering** — cheap model by default, escalate only on failed confidence check | 60-80% off the overall bill | Medium — needs the router logic from Part 2 | Every task |
| 3 | **Batch API for non-urgent tasks** (daily digests, overnight reports, bulk categorization) | 50% off input+output, stacks with caching for 95%+ combined | Low — just needs to tolerate delay (often under an hour, up to 24hr) | Anything not real-time |
| 4 | **Output length control** — structured/short responses instead of prose | Output tokens cost ~5x input, so this is disproportionately impactful for output-heavy tasks | Low — a prompt/schema constraint, not new infra | Content generation, reports |
| 5 | **Skip the call entirely** — canned responses, deterministic rules, real dedup | 100% of that specific cost | Medium — requires pattern detection on repeated task types | High-frequency repetitive tasks |

Real-world reference point: a typical mid-size agent request (6K input / 1K output tokens) runs roughly $0.18 uncached on a mid-tier model, drops to $0.05-$0.10 with caching alone, and can land under $0.02 once tiering, batching, and output control are all stacked on top.

**Build order:** implement caching and output-length control first (lowest effort, immediate impact on every call), then the tiering router, then batch routing for non-urgent task types, then the skip-the-call pattern detection last (needs usage data to know what's worth skipping).

---

## Part 4: Keeping roles from overlapping or costing double when they share an AI provider

Multiple roles will often use the same underlying model (e.g., both CFO and Support run on Claude) — that's fine and expected. What prevents overlap and duplicate cost is **isolation at the orchestration layer, not the model layer**. The model doesn't know or care which role it's acting as; your system has to enforce the boundaries:

- **A distinct system prompt/persona per agent instance**, never shared. The CFO agent and the Support agent both calling "Claude" are, from the platform's point of view, two completely separate agents that happen to use the same provider — same as two different employees who both went to the same school.
- **Isolated context and memory per agent.** The CFO agent's conversation history and knowledge base never leaks into the Support agent's, and vice versa. This also keeps each call's context smaller, which directly helps cost (Part 3, lever #1 and #4).
- **A central task router that tags every incoming task with role + sub-agent before dispatch.** The router — not the model — decides who handles what. This is the actual mechanism that prevents two agents from independently working the same task and doubling the cost.
- **Scoped tool/integration permissions per agent.** The Finance agent can't touch the social media connector; the Marketing agent can't touch the bank feed. This prevents accidental overlap and shrinks the security surface at the same time.
- **A deduplication check before dispatch.** If a task looks like something another agent already handled recently (e.g., a customer email that touches both billing and support), the router flags it for a single handoff between agents instead of letting both process it independently and pay for it twice.
- **Per-agent cost and activity logging**, not just per-role. This is what makes the dashboard actually useful — you can see that the CMO role's "ad-copy sub-agent" is expensive while its "social scheduling sub-agent" is cheap, instead of one blended number that hides where the spend is really going.

The practical result: sharing a provider across roles costs nothing extra and creates no functional overlap, as long as isolation happens in the orchestration layer. The risk isn't "using the same AI twice" — it's letting two agents see each other's context or work the same task without a defined handoff.

---

## Part 3: Cost reduction checklist — ranked by effort-to-savings ratio

| # | Lever | Savings | Effort to implement | Notes |
|---|---|---|---|---|
| 1 | Prompt caching on every role's static system prompt | Up to 90% off the cached portion | Low — mostly automatic once the system prompt is kept stable and separated from dynamic content | Do this first. Every role's persona/instructions are static by nature — free savings, no tradeoff |
| 2 | Model tiering (cheap-by-default routing) | 60-80% off overall bill | Medium — requires the task classifier from Part 2 | Second priority — this is the routing engine already designed |
| 3 | Batch API for non-urgent tasks | 50% off, stacks with caching for 95%+ combined | Low-medium | Use for daily/weekly digests, bulk categorization — anything that doesn't need an instant answer |
| 4 | Constrain output length / request structured output | Meaningful — output tokens cost ~5x input | Low | Ask for JSON/short structured responses instead of prose wherever the task allows it |
| 5 | Skip the call entirely (canned responses, deterministic rules, real dedup) | Highest possible — 100% on that task | Medium — needs pattern detection from usage analytics | Biggest long-run win but takes usage data to identify which tasks qualify |

**Real-world impact:** a typical mid-size request (6K input, 1K output tokens) runs about $0.18 uncached. Caching alone drops that to $0.05-$0.10. Stacking tiering, batching, and output constraints on top of caching can realistically bring the same task under $0.02 — roughly a 90%+ reduction from where it started.

**Build order:** caching and output constraints first (both are nearly free to implement and have zero downside). Model tiering next, since it needs the classifier. Batch API once you know which task types are genuinely non-urgent. The "skip the call" layer last, since it depends on real usage data to know what's worth eliminating.
