import viteReact from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// Deliberately separate from vite.config.ts: that config's tanstackStart()
// + nitroV2Plugin() plugins are what drive the production SSR/route-split
// build, and have no business running under a component test. Keeping
// this config down to just React + jsdom avoids any chance of the test
// runner interacting with the deploy build's own toolchain (see docs/
// DECISIONS.md ADR-016 for how much that toolchain has already cost us).
export default defineConfig({
  plugins: [viteReact()],
  test: {
    environment: "jsdom",
  },
});
