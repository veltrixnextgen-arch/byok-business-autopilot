#!/usr/bin/env node
// Enforces docs/TRACKING.md rule 9: apps/web's initial load stays under
// 150KB gzipped.
//
// Rewritten (performance work, docs/STATUS.md's "resolve the CI
// bundle-gate discrepancy" item) — the original version guessed which
// built .js files were "initial" vs. "lazy route chunk" by checking
// whether a filename started with a route name string. Two real bugs in
// that approach, found by comparing its number against what a real page
// load actually pays for:
//   1. It only ever measured ONE fixed set of files (whichever chunks
//      didn't happen to collide with a route-name prefix) — never the
//      worst case across actual routes. Several chunks (AppShell,
//      useAuthGuard, SchedulePauseBanner, brainKeyClient, handsKeyClient)
//      are shared across most authenticated routes, not just one, and a
//      filename-prefix guess has no way to know that without also
//      knowing which routes really pull them in.
//   2. It only ever globbed `*.js` — the built CSS file (every route
//      inherits it via the root layout) was invisible to the budget
//      entirely, real bytes every page load pays for and never counted.
//
// The actual, authoritative source for "what does route X really
// preload" is TanStack Start's own generated manifest
// (_tanstack-start-manifest_v-*.mjs) — the exact data the SSR renderer
// itself uses to emit <script>/<link> tags. This script now reads that
// manifest directly and computes the WORST-CASE route's real payload
// (root's always-loaded preloads + css, unioned with that route's own
// preloads), rather than guessing.
import { gzipSync } from "node:zlib";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const BUDGET_BYTES = 150 * 1024;
const webRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
// vite.config.ts pins nitroV2Plugin's preset to "vercel" unconditionally
// (STEP 6 / ADR-016 / issue #39) — every build (local or CI) always
// produces Vercel's Build Output API layout, never the classic
// `.output/public` Nitro default.
const staticDir = path.join(webRoot, ".vercel", "output", "static");
const functionsDir = path.join(webRoot, ".vercel", "output", "functions");

async function gzipSize(filePath) {
  const input = await readFile(filePath);
  return gzipSync(input, { level: 9 }).length;
}

async function findManifestPath() {
  // The manifest's filename carries a content hash that changes every
  // build (e.g. _tanstack-start-manifest_v-CGPB_b_u.mjs) — only its
  // prefix is stable, so this has to search rather than hardcode a name.
  const funcDirs = await readdir(functionsDir);
  for (const funcDir of funcDirs) {
    const chunksDir = path.join(functionsDir, funcDir, "chunks", "_");
    let entries;
    try {
      entries = await readdir(chunksDir);
    } catch {
      continue;
    }
    const match = entries.find((f) => f.startsWith("_tanstack-start-manifest_v-") && f.endsWith(".mjs"));
    if (match) return path.join(chunksDir, match);
  }
  throw new Error(`Could not find _tanstack-start-manifest_v-*.mjs under ${functionsDir} — did the build layout change?`);
}

async function main() {
  const manifestPath = await findManifestPath();
  const { tsrStartManifest } = await import(pathToFileURL(manifestPath).href);
  const routes = tsrStartManifest().routes;
  const root = routes.__root__;
  if (!root) throw new Error("Manifest has no __root__ entry — cannot determine the always-loaded baseline.");

  const sizeCache = new Map();
  async function sizeOf(assetPath) {
    if (sizeCache.has(assetPath)) return sizeCache.get(assetPath);
    const size = await gzipSize(path.join(staticDir, assetPath.replace(/^\//, "")));
    sizeCache.set(assetPath, size);
    return size;
  }

  async function totalFor(files) {
    const sizes = await Promise.all([...files].map(sizeOf));
    return sizes.reduce((a, b) => a + b, 0);
  }

  const rootFiles = new Set([...(root.preloads ?? []), ...(root.css ?? [])]);
  let worst = { route: "/ (root layout only)", files: rootFiles, total: await totalFor(rootFiles) };

  for (const [routePath, entry] of Object.entries(routes)) {
    if (routePath === "__root__") continue;
    const files = new Set([...rootFiles, ...(entry.preloads ?? []), ...(entry.css ?? [])]);
    const total = await totalFor(files);
    if (total > worst.total) worst = { route: routePath, files, total };
  }

  const rows = await Promise.all([...worst.files].map(async (f) => [f, await sizeOf(f)]));
  rows.sort((a, b) => b[1] - a[1]);

  console.log(`Worst-case initial load — route "${worst.route}" (root layout's own preloads/css + that route's):`);
  for (const [file, size] of rows) {
    console.log(`  ${file.padEnd(40)} ${(size / 1024).toFixed(2)} KB gzip`);
  }
  console.log(`Total: ${(worst.total / 1024).toFixed(2)} KB gzip (budget: ${(BUDGET_BYTES / 1024).toFixed(0)} KB)`);

  if (worst.total > BUDGET_BYTES) {
    console.error(`\n::error::Worst-case initial load (route "${worst.route}") is ${(worst.total / 1024).toFixed(2)} KB gzip, over the ${(BUDGET_BYTES / 1024).toFixed(0)} KB budget.`);
    process.exitCode = 1;
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
