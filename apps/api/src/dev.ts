import { createDevTrustCore } from "./dev/devTrustCore.js";
import { readServerConfigFromEnv, startServer } from "./server.js";

startServer(readServerConfigFromEnv(), createDevTrustCore());
