import { createDevTrustCore } from "./dev/devTrustCore.js";
import { readServerConfigFromEnv, startServer } from "./server.js";

// Staging entrypoint. Reuses the same in-memory Router/CostGate/ApprovalQueue
// wiring as local `npm run dev` (createDevTrustCore) — deliberately, not a
// stopgap: this deploy's whole point is proving auth -> tenant -> RLS-scoped
// API resolves end to end at a real URL (the STEP 1 dashboard's /me call),
// which never touches trust-core's /tasks route. Real pricing/ceiling
// config and durable trust-core storage are a separate decision for
// whoever owns that (see server.ts's comment) — not invented here just to
// have a deploy target.
startServer(readServerConfigFromEnv(), createDevTrustCore());
