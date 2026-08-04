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
export default defineConfig({
  server: {
    port: 3002,
  },
  plugins: [tanstackStart(), nitroV2Plugin({ preset: "vercel" }), viteReact(), tailwindcss()],
});
