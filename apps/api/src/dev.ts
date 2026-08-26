import { createPool, runMigrations, verifyNoPublicApiExposure, verifySchemaCurrent } from "@byok/db";
import { createDevTrustCore } from "./dev/devTrustCore.js";
import { readServerConfigFromEnv, startServer } from "./server.js";

const config = readServerConfigFromEnv();
const pool = createPool({ connectionString: config.databaseUrl });

// ADR-022: migrations run on every boot, local dev included — no longer a
// separate manual `npm run db:migrate` step (every statement in every
// migration file is idempotent, safe to re-run; see migrate.ts). Keeps
// local dev from being able to silently drift from what the code expects
// the same way staging did.
await runMigrations(pool);
await verifySchemaCurrent(pool);
await verifyNoPublicApiExposure(pool);

startServer(config, createDevTrustCore(pool, { google: config.google ?? undefined }), pool);
