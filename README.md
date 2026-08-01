# BYOK Business Autopilot

A user describes their business idea once. On the platform's own dime (a capped few cents), the system reverse-engineers the idea **bottom-up** — every granular task → one sub-agent per task type → teams → the role assembled last to lead each team — presents the org chart as an animation of their own company assembling, lets them **name** every agent, pick each role's **Brain** (LLM provider, smart-defaulted) and see which **Hands** (service APIs) each team will later request, then shows them a **simulated first day** of their company running. From there everything is BYOK: guided key setup, three independent spend walls, then the **Company Charter** (idea → MVP definition → every role's tasks → goals) is reviewed, approved, and ceremonially handed to their named CEO agent, whose master prompt it becomes. Automation goes live: agents work, everything lands in an approval queue, autonomy is earned per task type, the CEO synthesizes and recommends but can never execute, and if the idea needs software, a parallel build branch commits every change to the **user's own GitHub repo** behind a staged, human-approved deploy pipeline. The app the user lives in afterward is simply their **company dashboard, where their employees report every day** — at pass-through cost, with zero markup on intelligence.

## Documentation map

| Order | Doc | Description |
|---|---|---|
| 1 | [docs/strategy/master-plan-v2.md](docs/strategy/master-plan-v2.md) | Strategy, economics, build plan, MVP ladder — the primary reference |
| 2 | [docs/product/userflow-v2.md](docs/product/userflow-v2.md) | The end-to-end user flow |
| 3 | [docs/architecture/system-architecture-v6-technical.mermaid](docs/architecture/system-architecture-v6-technical.mermaid) | Current technical system architecture |
| 4 | [docs/architecture/system-architecture-v5-conceptual.mermaid](docs/architecture/system-architecture-v5-conceptual.mermaid) | Conceptual bottom-up-teams architecture |
| 5 | [docs/architecture/security-architecture.md](docs/architecture/security-architecture.md) | Security architecture (vault, key handling, trust core) |
| 6 | [docs/product/roles-and-api-key-guide.md](docs/product/roles-and-api-key-guide.md) | Role catalog and per-role API key guides |
| — | [docs/archive/master-plan-v1.md](docs/archive/master-plan-v1.md) | *Superseded* — v1 master plan, kept for history |
| — | [docs/archive/deployment-safety-and-cost-routing.md](docs/archive/deployment-safety-and-cost-routing.md) | *Superseded* — earlier deployment/cost-routing draft |
| — | [docs/archive/system-architecture-v4-bottomup-teams.mermaid](docs/archive/system-architecture-v4-bottomup-teams.mermaid) | *Superseded* — v4 architecture diagram |

## Build order

Full detail lives in [docs/strategy/master-plan-v2.md](docs/strategy/master-plan-v2.md) — summarized here, not duplicated.

- **Phase A** (Claude Code, wk 1–4): shell + router service (wraps [`@open-multi-agent/core`](https://www.npmjs.com/package/@open-multi-agent/core) — ⚠️ not the unrelated bare `open-multi-agent` npm package) + trust core (key vault, cost gate, approval queue, Task Extraction Engine).
- **Phase B** (Emergent, wk 3–6): commodity UI surface — onboarding, org-chart animation, approval-queue UI, Charter editor, dashboard, billing. CODEOWNERS-locked out of the trust core.
- **Phase C** (wk 6–10): staging/deploy pipeline, mobile wrap, push-notification approvals.

**MVP ladder:** MVP-0 (chart + simulated day, no keys/execution) → MVP-1 (BYOK + spend walls + Charter handoff + first executing role) → MVP-2 (multi-role, CEO recommendation loop, earned autonomy, Agency workspaces) → MVP-3 (parallel build branch into the user's own GitHub repo, staged deploys).

## Local development

The shell (`apps/api`) needs Postgres and Redis. One command starts both:

```bash
docker compose up -d
```

Then, from repo root:

```bash
cp .env.example .env        # fill in DATABASE_URL/REDIS_URL if you changed the defaults
npm install
npm run db:migrate          # applies packages/db/src/migrations against DATABASE_URL
npm test                    # every package's test suite
npm run typecheck           # tsc across every workspace
npm run lint                # ESLint — includes the trust-core boundary rule, ADR-009
```

`apps/api` itself isn't started by a script yet — trust-core (`Router`/`CostGate`/`ApprovalQueue`) construction is a deployment-level decision (pricing table, ceilings) that hasn't been made yet; see `apps/api/src/server.ts`'s `startServer()` for the seam it's meant to be wired through.

### Repo layout

- `apps/router` — the router service (trust core, CODEOWNERS-locked, ADR-005)
- `packages/vault`, `packages/cost-gate`, `packages/approval-queue` — trust core (CODEOWNERS-locked)
- `packages/db` — Drizzle schema + Postgres RLS tenant isolation (Ring 1, security-architecture.md §4)
- `packages/auth` — Better Auth config (multi-tenancy via the organization plugin, MFA, the step-up permission concept for T6)
- `packages/jobs` — BullMQ queues/workers with a required, typed `tenantId` on every payload
- `apps/api` — the shell's typed API boundary; talks to trust-core only through each package's public `index.ts` (ADR-009, enforced by `eslint.config.js`)
- `apps/web` — Phase B UI surface, not yet built
