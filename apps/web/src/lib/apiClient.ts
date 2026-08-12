import type { AppType } from "@byok/api";
import { hc } from "hono/client";

// Type-only import above — erased at compile time, so this never pulls
// Node-only apps/api code (or its dependencies) into the browser bundle.
// This IS the "typed API boundary": every route apps/api adds shows up
// here as a typed method automatically, no separate schema to maintain.
// Exported (not just used inline) so the OAuth Hands connect flow
// (OrgChartScreen.tsx, PR 2B) can build a plain <a href> to apps/api's
// /hands-oauth/:service/start — a top-level browser navigation, not a
// typed hc() call, since it needs to leave the page for the provider's
// consent screen and back.
export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

export const apiClient = hc<AppType>(API_URL, {
  init: { credentials: "include" },
});
