# Runwisely

*The GitHub repo is still named `byok-business-autopilot` and the internal `@byok/*` package scope is unchanged — both are legacy from before the product was named. See ADR-017.*

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
| 7 | [docs/architecture/dashboard-data-contract.md](docs/architecture/dashboard-data-contract.md) | Read-side query API the Phase B dashboard UI consumes |
| — | [docs/archive/master-plan-v1.md](docs/archive/master-plan-v1.md) | *Superseded* — v1 master plan, kept for history |
| — | [docs/archive/deployment-safety-and-cost-routing.md](docs/archive/deployment-safety-and-cost-routing.md) | *Superseded* — earlier deployment/cost-routing draft |
| — | [docs/archive/system-architecture-v4-bottomup-teams.mermaid](docs/archive/system-architecture-v4-bottomup-teams.mermaid) | *Superseded* — v4 architecture diagram |

## Build order

Full detail lives in [docs/strategy/master-plan-v2.md](docs/strategy/master-plan-v2.md) — summarized here, not duplicated.

- **Phase A** (Claude Code, wk 1–4): shell + router service (wraps [`@open-multi-agent/core`](https://www.npmjs.com/package/@open-multi-agent/core) — ⚠️ not the unrelated bare `open-multi-agent` npm package) + trust core (key vault, cost gate, approval queue, Task Extraction Engine).
- **Phase B** (Claude Code, wk 3–6): commodity UI surface — onboarding, org-chart animation, approval-queue UI, Charter editor, dashboard, billing. Built one branch/one PR per step (ADR-010); same CODEOWNERS review, lint boundary, and required CI as the rest of the repo.
- **Phase C** (wk 6–10): staging/deploy pipeline, mobile wrap, push-notification approvals.

**MVP ladder:** MVP-0 (chart + simulated day, no keys/execution) → MVP-1 (BYOK + spend walls + Charter handoff + first executing role) → MVP-2 (multi-role, CEO recommendation loop, earned autonomy, Agency workspaces) → MVP-3 (parallel build branch into the user's own GitHub repo, staged deploys).

## Local development

First-time setup, from repo root:

```bash
cp .env.example .env        # fill in DATABASE_URL/REDIS_URL/WEB_ORIGIN if you changed the defaults
npm install
docker compose up -d --wait # Postgres + Redis, waits for both healthchecks
```

**`.env`'s `ANTHROPIC_API_KEY` only matters for two things: `npm run extract` (the extraction CLI, `packages/agents/extraction`) and the fixture/experiment scripts under `test/` (`run-differentiation.ts`, `fix-missing-batch.ts`, `experiment-haiku-batch.ts`) — all of them make real Anthropic calls and need a *valid* key.** `apps/api`'s own server (`npm run dev`) requires the variable to be *present* to boot at all (`readServerConfigFromEnv` in `apps/api/src/server.ts` throws on an empty/missing value), but doesn't need it to be *valid* unless you actually drive an idea through the interview/extraction locally — the auth+tenant `/dashboard` proof below doesn't touch it. `npm test` doesn't depend on it at all (unit tests inject a fake placeholder value, never a real key). Staging reads its own copy from the `ANTHROPIC_API_KEY` GitHub Actions secret, set independently of this file — a stale or broken local `.env` key never affects what's deployed, and a working deploy never means the local key is fine.

Then, day to day:

```bash
npm run dev                 # docker compose up -d --wait, then apps/api + apps/web together
```

`apps/api` serves on `:3000` by default (see `apps/api/src/dev.ts` — it wires a real but single-process, in-memory `Router`/`CostGate`/`ApprovalQueue` via `apps/api/src/dev/devTrustCore.ts`, explicitly dev-only; a deployed environment needs its own real pricing/ceiling decisions instead, see `server.ts`). `apps/web` serves on `:3002`. Sign up at `/signup`, then `/dashboard` proves auth + tenant + API resolve end to end.

**Migrations run automatically on every boot now (ADR-022), local dev included** — `dev.ts`/`start.ts` call `runMigrations` before the server starts listening, and every statement in every migration file is written idempotent (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` + `CREATE POLICY`, `ADD COLUMN IF NOT EXISTS`) specifically so this is safe to re-run against an already-current database on every restart. There's no separate manual migrate step anymore, and no "don't re-run this" caveat — that used to be true before the migrations were made idempotent and is not true today. A `verifySchemaCurrent` check runs right after, independently, and refuses to boot (matching ADR-007/008's fail-closed pattern) if the schema is still behind what the code expects for any reason.

```bash
npm test                    # every package's test suite (in-memory fakes, no Docker needed)
npm run test:integration    # atomicity/durability proofs against the REAL Postgres above
npm run typecheck           # tsc across every workspace, plus a real `vite build` + tsc for apps/web
npm run lint                # ESLint — includes the trust-core boundary rule, ADR-009
```

### Repo layout

- `apps/router` — the router service (trust core, CODEOWNERS-locked, ADR-005)
- `packages/vault`, `packages/cost-gate`, `packages/approval-queue` — trust core (CODEOWNERS-locked)
- `packages/db` — Drizzle schema + Postgres RLS tenant isolation (Ring 1, security-architecture.md §4)
- `packages/auth` — Better Auth config (multi-tenancy via the organization plugin, MFA, the step-up permission concept for T6) + a browser client (`@byok/auth/client`) apps/web consumes
- `packages/jobs` — BullMQ queues/workers with a required, typed `tenantId` on every payload
- `apps/api` — the shell's typed API boundary; talks to trust-core only through each package's public `index.ts` (ADR-009, enforced by `eslint.config.js`)
- `apps/web` — TanStack Start frontend. Foundation only so far (Phase B Step 1): auth pages + a minimal authenticated dashboard proving the stack is wired together, no product UI yet
