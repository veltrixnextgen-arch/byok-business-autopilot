import type { AppType } from "@byok/api";
import { hc } from "hono/client";

// Type-only import above — erased at compile time, so this never pulls
// Node-only apps/api code (or its dependencies) into the browser bundle.
// This IS the "typed API boundary": every route apps/api adds shows up
// here as a typed method automatically, no separate schema to maintain.
const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export const apiClient = hc<AppType>(API_URL, {
  init: { credentials: "include" },
});
