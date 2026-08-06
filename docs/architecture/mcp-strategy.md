# MCP strategy — inbound and outbound, evaluated separately

Model Context Protocol shows up in two completely different roles for Runwisely, and conflating them is the easiest way to reach the wrong conclusion about either: **inbound** is Runwisely as an MCP *client*, using other people's MCP servers as a Hands transport. **Outbound** is Runwisely as an MCP *server*, letting a user's own Claude/ChatGPT app call into Runwisely. This document evaluates each on its own terms and ends with one recommendation, gated to a milestone.

---

## 1. Inbound — Runwisely consuming MCP servers as a Hands transport

**What it is.** Instead of (or alongside) a bespoke SDK client per service in `docs/design/tool-registry.md` §2, the router's executor could call a Hands action through an MCP server that already wraps that service — e.g. a community-maintained GitHub MCP server instead of hand-rolling GitHub API calls.

### What it buys

- **Integration velocity for long-tail services.** The tool registry lists ~20 Hands categories; some (Stripe, GitHub) are worth a first-class bespoke client regardless, but for a lower-traffic category, an existing MCP server can be faster to stand up than writing and maintaining an SDK wrapper.
- **A standard tool-calling shape.** MCP defines the tool-schema/invocation contract once; the router's `AgentExecutor` interface (`apps/router/src/executor.ts`) already abstracts *how* execution happens behind one interface (ADR-006's pattern) — an MCP-backed executor implementation would slot in there without touching callers.

### What it costs

- **A new trust surface, not a free one.** An MCP server is third-party code the router would be invoking with (scoped) user credentials. It needs the exact same scoping, auditing, and effect-gating review as any Hands integration in the registry — MCP doesn't grant it a pass through trust-core, it's just a different transport for the same untrusted-until-scoped category of call.
- **Multi-tenant hosting complexity.** Most public MCP servers today assume a single local process talking to a single client (Claude Desktop, an IDE) — running one per tenant, or multiplexing tenants through a shared instance safely, is real infrastructure work with no established pattern yet.
- **Spec and ecosystem immaturity.** MCP is young; server quality, auth conventions, and even transport (stdio vs. HTTP/SSE) vary by publisher. Adopting one is closer to adopting a dependency than adopting a standard, in practice, today.
- **Another network hop and another failure mode** in a system whose cost gate and approval queue already assume a specific latency/reliability shape for effect execution.

### On inference economics — stated plainly, because this is the part most likely to get hand-waved

**Inbound MCP does not change inference economics at all.** MCP is a tool-*calling* transport — it governs how a Hands action gets invoked, not which Brain does the reasoning that decides to invoke it. Whether "send this Slack message" happens through a bespoke Slack SDK call or through a Slack MCP server, the agent still had to think first, and that thinking still spends the user's own Brain API key exactly the same way (ADR-002, ADR-003: platform pays for onboarding only, everything after is BYOK). Nothing about swapping a Hands transport touches which tier a task runs on, which provider it calls, or the cost gate's reservation math. Anyone evaluating inbound MCP as a cost lever is evaluating the wrong thing — it's an integration-effort lever, not a spend lever.

---

## 2. Outbound — Runwisely exposed as an MCP server

**What it is.** A user connects Runwisely inside their own Claude or ChatGPT app (a remote MCP server, OAuth-authenticated) and interacts with their company from inside that conversation instead of (or alongside) `apps/web`. Their subscription — Claude Pro, ChatGPT Plus, whatever — pays for that interactive session; Runwisely never touches inference cost for it.

### What tools we'd expose

Read-heavy by default, matching the same caution the approval queue already applies to effects:

| Tool | Kind | Notes |
|---|---|---|
| List pending approvals | Read | Mirrors Screen 7 (the approval queue home screen) |
| Get task/agent status | Read | Mirrors the dashboard |
| Get today's spend vs. ceiling | Read | Mirrors the morning digest |
| Approve / Decline / Modify a pending action | **Effect** | Must resolve through the exact same `ProposedAction` → `EffectDescriptor` pathway (`packages/approval-queue/src/types.ts`) as approving through the UI — never a shortcut path |
| Draft a reply to feed a task's agent context ("Fix this") | Effect (feedback only, no dispatch) | Mirrors the existing feedback-comment mechanism |

Deliberately **not** exposed: anything that creates new spend commitments, changes budget ceilings, or touches key/vault management — those stay UI-only, at least initially, because they're the highest-stakes actions in the system and the UI can show context (masked fingerprints, current ceiling) that a chat tool-call response can't as reliably.

### How auth would work

MCP's current spec direction for remote servers is OAuth 2.1. Runwisely already runs Better Auth for `apps/web`/`apps/api` sessions — an MCP connection becomes a third authenticated client type (alongside the web app and the mobile-web PWA), issued its own scoped, revocable token through the same auth boundary, not a parallel credential system. The user "connects" Runwisely inside their Claude/ChatGPT app the same consent-screen way they'd connect any other MCP server; Runwisely never sees or handles their Claude/ChatGPT credentials, and Claude/ChatGPT never sees Runwisely's session cookie — standard OAuth delegation, nothing new invented.

### Trust-core implications — per T2

`docs/architecture/security-architecture.md`'s T2 threat is prompt injection: "a malicious email/ticket/webpage hijacks an agent." **An MCP client is architecturally the same class of untrusted caller**, even when it's genuinely the account owner on the other end. The request now originates from a general-purpose LLM conversation Runwisely doesn't control the contents of — if that conversation has ingested untrusted content (a pasted email, a fetched webpage) before or alongside asking Runwisely's MCP tools to do something, the same hijack shape T2 already defends against applies, just arriving through a new transport instead of through one of Runwisely's own agents.

The existing T2 defenses transfer directly and don't need new ones invented:

- **The approval queue is still the final firewall.** An MCP "approve" tool call still has to pass through the same `ProposedAction`/`EffectDescriptor` gate a UI click does — MCP is a new *front door*, not a new *effect pathway*. A hijacked MCP session can, at absolute worst, produce a bad approval — which the underlying action's own `EffectDescriptor.description` still renders in plain language, same as today, before anything happens. (Whether "approve" via MCP should *itself* require a second confirmation, given it's one hop further from the user's eyes than a UI click, is an open design question worth resolving before shipping this — noted here, not decided here.)
- **Tool scoping caps blast radius.** The MCP session's token should be scoped no more broadly than the read/effect table above — it never gets a bank-feed-equivalent credential just because the human on the other end theoretically could grant one through the UI.
- **Immutable expectations per tool.** Each exposed MCP tool should have one fixed job (matching "immutable role prompts per dispatch" from T2's existing mitigation) — a read tool that could be coerced into also accepting write-shaped arguments is exactly the kind of ambiguity T2's mitigations already exist to close off.

None of this is a new trust-core component. It's the existing approval-queue/scoping architecture, pointed at one more caller type.

### Could background agent work ever run this way?

**No — and it's worth being precise about why, because "MCP server" sounds like it could mean more than it does.** MCP servers are invoked *by* a client, *during* an active session; the protocol has no mechanism for a server to initiate work on its own schedule. (MCP's "sampling" capability lets a server ask the *client's* model to complete something — but only synchronously, in response to a live tool call inside a session that's already open; it's not a background-job primitive.) Runwisely's actual product — agents doing real work on a cadence, dispatched through the router, reserved against the cost gate, landing in the approval queue whether or not anyone's looking — has to keep running whether or not a user's Claude/ChatGPT app happens to be connected at that moment. That's what BullMQ, the router, and the durable stores in `packages/db` already are, and outbound MCP doesn't replace or reduce the need for any of it. Outbound MCP is a **window into** an already-running background system, never the mechanism that runs it.

---

## 3. Recommendation

**Outbound is a post-MVP-1 distribution play, not a pre-pilot feature — agreed, arguing for it, not against it.**

The pilot's entire job right now is proving the core loop works in `apps/web`: idea → org chart → BYOK graduation → one role executing on real user keys with a real approval queue people actually trust. Outbound MCP is net-new work on every axis that matters for that: a new OAuth flow, a new tool-schema surface to design and review, and — per §2 above — a genuinely new untrusted-caller boundary into trust-core that needs its own security review, not a rubber-stamped extension of an existing one. None of that risk buys anything toward whether 20 pilot testers get value from the product this month. It's a distribution/growth lever, and those matter more once there's a proven, trusted core to distribute — not before one exists.

Concretely: **land it no earlier than MVP-1 close ("one role executing end-to-end on user keys with full approval queue," issue #19), and treat MVP-2 ("Full org," where the digest and multi-role queue are real) as the more natural target** — exposing "approve today's queue" via MCP is a much lower-risk, higher-leverage move once that queue reflects a whole running company instead of one role's trial output. No issue opened for this yet, per this task's scope — it's a milestone recommendation for whoever schedules Phase C, not a commitment being made today.

**Inbound gets a lighter, different recommendation: worth a narrow prototype around the same MVP-1/MVP-2 timeframe, not a wholesale adoption decision now.** Pick one already-mature, low-stakes MCP server (GitHub's is the obvious first candidate — Product/Dev's Build agent already needs GitHub access, and a well-audited official server exists) and build one `AgentExecutor` implementation against it, behind the same interface every other executor already uses. That answers the multi-tenant-hosting and reliability questions with real data instead of speculation, without committing the tool registry's other ~20 Hands categories to MCP before knowing whether the pattern actually holds up in production.
