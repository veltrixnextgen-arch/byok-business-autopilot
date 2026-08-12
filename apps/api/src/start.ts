import { createPool, runMigrations, verifySchemaCurrent } from "@byok/db";
import { createDevTrustCore } from "./dev/devTrustCore.js";
import { readServerConfigFromEnv, startServer } from "./server.js";

// Staging entrypoint. Reuses the same in-memory Router/CostGate/ApprovalQueue
// wiring as local `npm run dev` (createDevTrustCore) — deliberately, not a
// stopgap: this deploy's whole point is proving auth -> tenant -> RLS-scoped
// API resolves end to end at a real URL (the STEP 1 dashboard's /me call),
// which never touches trust-core's /tasks route. Real pricing/ceiling
// config and durable trust-core storage are a separate decision for
// whoever owns that (see server.ts's comment) — not invented here just to
// have a deploy target. Vault's KMS is the one piece that IS genuinely
// staging-real: createDevTrustCore picks StagingKms over LocalKms
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

startServer(config, createDevTrustCore(pool, { google: config.google ?? undefined }), pool);
