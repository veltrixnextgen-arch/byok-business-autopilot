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

// Same Railway domain vercel.json's own rewrite destination hardcodes —
// confirmed via the Railway API when the proxy was built (ADR-053), not
// guessed. Duplicated here rather than read from vercel.json at build
// time because there's no build-time channel from that file into this
// one; if the Railway domain ever changes, both need updating together.
const RAILWAY_API_ORIGIN = "https://byokapi-production-6a57.up.railway.app";

// Extraction deliberately stays cross-origin even once the same-origin
// proxy is live — see extractionClient.ts's own comment for why (the
// Vercel edge rewrite's ~120s CDN origin timeout has too little headroom
// over extraction's real measured latency). When API_URL is "" (proxy
// mode — ADR-053), fall back to the real Railway origin instead of
// resolving against the current page's own origin; in every other mode
// (local dev, or a pre-cutover absolute VITE_API_URL) API_URL is already
// the right direct origin, so this is identical to apiClient.
export const directApiClient = hc<AppType>(API_URL === "" ? RAILWAY_API_ORIGIN : API_URL, {
  init: { credentials: "include" },
}).api;
