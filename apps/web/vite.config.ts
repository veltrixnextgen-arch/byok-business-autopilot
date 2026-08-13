import tailwindcss from "@tailwindcss/vite";
import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import { nitroV2Plugin } from "@tanstack/nitro-v2-vite-plugin";
import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// STEP 6 / ADR-016 / issue #39: the first-party `nitro/vite` (Nitro v3,
// still on a date-versioned nightly channel — no numbered stable release
// past 3.0.0, which itself doesn't support vite@8) produced an SSR
// bundle calling jsxDEV in production. That's not unique to us — Nitro
// v3 has multiple open upstream bugs against TanStack Start + Vercel
// (nitrojs/nitro#3905 prerender failures, nitrojs/nitro#3965 wrong Node
// version, vitejs/rolldown-vite#580 unresponsive server on vite@8 beta).
// @tanstack/nitro-v2-vite-plugin wraps nitropack@2.x — the mature,
// long-stable Nitro line Nuxt/SolidStart have shipped on for years —
// and is still an officially supported (if no longer the new-project
// default) TanStack Start path. Explicit preset: "vercel" rather than
// relying on auto-detection, since the v2 plugin doesn't advertise the
// same Vercel-build-env auto-detection the v3 rewrite added.
// Explicit NODE_ENV define — hardening against the same class of bug the
// comment above already documents once (jsxDEV shipped to the SSR
// bundle). Found live in production this time on the CLIENT bundle:
// index-*.js on runwisely-autopilot.vercel.app carries react-dom's
// development-only warning strings ("Do not call Hooks inside...") and
// lacks the production build's "Minified React error" markers, even
// though Vite's own build log labels the same build "for production."
// A byte-identical local `vite build` from the same commit does NOT
// reproduce this — the live artifact came from a build that reused a
// stale cache ("Restored build cache from previous deployment" in
// Vercel's build log), which is the suspected mechanism, not this
// config. This define doesn't fix a stale cache; it removes the
// ambiguity react-dom's `if (process.env.NODE_ENV === 'production')`
// branch otherwise depends on the bundler resolving correctly on its
// own, so the same failure mode can't quietly recur even if a future
// cache/toolchain hiccup reintroduces it.
export default defineConfig(({ mode }) => ({
  server: {
    port: 3002,
  },
  // Function form (not a static object) deliberately — `mode` must stay
  // "development" for `vite dev`, or local dev would run production
  // React (no dev warnings, slower iteration) instead of hardening
  // anything real.
  define: {
    "process.env.NODE_ENV": JSON.stringify(mode),
  },
  plugins: [tanstackStart(), nitroV2Plugin({ preset: "vercel" }), viteReact(), tailwindcss()],
}));
