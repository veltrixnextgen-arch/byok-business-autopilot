import { createPool } from "@byok/db";
import { createDevTrustCore } from "./dev/devTrustCore.js";
import { readServerConfigFromEnv, startServer } from "./server.js";

const config = readServerConfigFromEnv();
const pool = createPool({ connectionString: config.databaseUrl });
startServer(config, createDevTrustCore(pool, { google: config.google ?? undefined }), pool);
