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
// Cross-origin (Railway) by default — matches local dev, where apps/web
// and apps/api genuinely run on different ports and vercel.json's rewrite
// doesn't exist. In production with the same-origin proxy (ADR-053,
// issue #144), set VITE_API_URL="" at build time instead: every request
// this file makes is already a relative path against AppType's own
// route tree, so an empty base resolves against the current page's own
// origin, which is exactly what makes the session cookie first-party.
export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

// ADR-053 (same-origin proxy, issue #144): apps/api's browser-facing
// routes are mounted under /api server-side now (index.ts's browserApi),
// so AppType's own tree nests everything one level deeper than it used
// to. Pre-scoping the exported client to `.api` here — once, in the one
// place that constructs it — means every existing call site across this
// codebase (apiClient.dashboard.$get(), apiClient.me..., etc.) keeps
// working unchanged, rather than every one of them needing its own
// `.api.` inserted.
export const apiClient = hc<AppType>(API_URL, {
  init: { credentials: "include" },
}).api;
