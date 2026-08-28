#!/usr/bin/env node
// Assigns real sequential numbers to every "## ADR-PENDING — ..." heading
// in docs/DECISIONS.md, in file order, starting after the current highest
// "## ADR-NNN". Run this once, on main, right at merge time — not on a
// branch — so the number is only ever claimed at the one point where
// there's a single linear order, instead of guessed by parallel branches
// racing for the same next integer (the actual recurring cost this
// replaces: five merges in one session needed a hand-resolved ADR-number
// collision because two+ branches each guessed the same number).
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const DECISIONS_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "docs", "DECISIONS.md");

const original = readFileSync(DECISIONS_PATH, "utf8");
const lines = original.split("\n");

let maxExisting = 0;
for (const line of lines) {
  const m = line.match(/^## ADR-(\d+) —/);
  if (m) maxExisting = Math.max(maxExisting, Number(m[1]));
}

let next = maxExisting + 1;
let assigned = 0;
const output = lines.map((line) => {
  if (!line.startsWith("## ADR-PENDING —")) return line;
  const rewritten = line.replace("## ADR-PENDING —", `## ADR-${String(next).padStart(3, "0")} —`);
  console.log(`Assigned ADR-${String(next).padStart(3, "0")}: ${line.replace("## ADR-PENDING — ", "")}`);
  next += 1;
  assigned += 1;
  return rewritten;
});

if (assigned === 0) {
  console.log("No ADR-PENDING headings found — nothing to assign.");
  process.exit(0);
}

writeFileSync(DECISIONS_PATH, output.join("\n"));
console.log(`Assigned ${assigned} ADR number(s). Review and commit docs/DECISIONS.md.`);
