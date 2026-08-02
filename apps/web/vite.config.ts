import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import viteReact from "@vitejs/plugin-react";
import { nitro } from "nitro/vite";
import { defineConfig } from "vite";

// nitro() is required for Vercel deployment (auto-detects the Vercel
// preset from Vercel's own build environment — no explicit preset config
// needed here) — see https://vercel.com/docs/frameworks/full-stack/tanstack-start.
export default defineConfig({
  server: {
    port: 3002,
  },
  plugins: [tanstackStart(), nitro(), viteReact()],
});
