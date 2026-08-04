#!/usr/bin/env node
// Enforces docs/TRACKING.md rule 9: apps/web's initial JS bundle stays
// under 150KB gzipped. "Initial" excludes per-route lazy chunks (each
// route's own component code, only fetched on navigation there) and
// counts everything else (framework/vendor chunks, shared components,
// the root/index chunk) — the set every page load actually pays for.
// The route-name exclude list is derived from the route files present at
// build time, not hand-maintained, so it can't silently drift stale.
import { gzipSync } from "node:zlib";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BUDGET_BYTES = 150 * 1024;
const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// vite.config.ts pins nitroV2Plugin's preset to "vercel" unconditionally
// (STEP 6 / ADR-016 / issue #39) — every build (local or CI) always
// produces Vercel's Build Output API layout, never the classic
// `.output/public` Nitro default.
const assetsDir = path.join(webRoot, ".vercel", "output", "static", "assets");
const routesDir = path.join(webRoot, "src", "routes");

async function gzipSize(filePath) {
  const input = await readFile(filePath);
  return gzipSync(input, { level: 9 }).length;
}

async function main() {
  const routeFiles = await readdir(routesDir);
  const lazyRouteNames = routeFiles
    .filter((f) => f.endsWith(".tsx") && f !== "__root.tsx" && f !== "index.tsx")
    .map((f) => f.replace(/\.tsx$/, ""));

  const assetFiles = (await readdir(assetsDir)).filter((f) => f.endsWith(".js"));
  const initial = [];
  const lazy = [];
  for (const file of assetFiles) {
    const isLazyRoute = lazyRouteNames.some((name) => file.startsWith(`${name}-`));
    (isLazyRoute ? lazy : initial).push(file);
  }

  let totalGzip = 0;
  const rows = [];
  for (const file of initial) {
    const size = await gzipSize(path.join(assetsDir, file));
    totalGzip += size;
    rows.push([file, size]);
  }
  rows.sort((a, b) => b[1] - a[1]);

  console.log("Initial JS bundle (excludes lazy route chunks: " + lazyRouteNames.join(", ") + "):");
  for (const [file, size] of rows) {
    console.log(`  ${file.padEnd(30)} ${(size / 1024).toFixed(2)} KB gzip`);
  }
  console.log(`Total: ${(totalGzip / 1024).toFixed(2)} KB gzip (budget: ${(BUDGET_BYTES / 1024).toFixed(0)} KB)`);

  if (lazy.length > 0) {
    console.log(`\nLazy route chunks (not counted toward the budget): ${lazy.join(", ")}`);
  }

  if (totalGzip > BUDGET_BYTES) {
    console.error(`\n::error::Initial JS bundle is ${(totalGzip / 1024).toFixed(2)} KB gzip, over the 150 KB budget.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
