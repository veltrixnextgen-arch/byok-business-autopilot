import { createPool, runMigrations, verifySchemaCurrent } from "@byok/db";
import { createDurableTrustCore } from "./durableTrustCore.js";
import { readServerConfigFromEnv, startServer } from "./server.js";

// Staging entrypoint. Originally reused the same in-memory
// Router/CostGate/ApprovalQueue wiring as local `npm run dev`
// (createDevTrustCore) — deliberately, at the time: this deploy's whole
// point was proving auth -> tenant -> RLS-scoped API resolves end to end
// at a real URL, which never touched trust-core's dispatch path. ADR-026:
// that stopped being true the moment R3's scheduler started calling
// Router.submitTask unattended — a queued approval-queue item or cost-gate
// reservation that vanishes on the next redeploy proves nothing real.
// createDurableTrustCore wires the Postgres-backed reservation/approval
// stores instead (see its own comment for exactly what is and isn't
// durable after this change). Vault's KMS is unaffected either way — it
// was already genuinely staging-real: StagingKms is picked over LocalKms
// automatically when STAGING_KMS_MASTER_KEY is set (deploy-staging.yml
// sets it fresh every deploy — see ADR-007).
const config = readServerConfigFromEnv();
const pool = createPool({ connectionString: config.databaseUrl });

// ADR-022: migrations run on every boot now, not just on a tagged
// deploy-staging.yml run — this is the fix for the exact incident that
// motivated it (2026-08-08 to 2026-08-12: migrations 0006/0007 shipped in
// eleven merged PRs while Railway's own code auto-deploy kept redeploying
// current code against a database nothing had migrated in days, since
// only a manual staging-tag push ever ran deploy-staging.yml's migration
// step). verifySchemaCurrent is intentionally a second, independent call,
// not folded into runMigrations — it still catches drift even if some
// future change to this file accidentally removes the runMigrations line
// above but leaves this one.
await runMigrations(pool);
await verifySchemaCurrent(pool);

startServer(config, createDurableTrustCore(pool, { google: config.google ?? undefined }), pool);
