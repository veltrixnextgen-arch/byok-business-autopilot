#!/usr/bin/env node
// Enforces docs/DECISIONS.md's audit-allowlist ADR: `npm audit
// --audit-level=high` stays the severity floor (moderate findings never
// fail this gate), but a high/critical finding only fails the build if
// it ISN'T a deliberately accepted, still-valid entry in
// .github/audit-allowlist.json. Two independent failure conditions:
//   1. A high/critical finding whose advisory isn't in the allowlist.
//   2. An allowlist entry that has passed its own expiresAt — accepted
//      risk must be re-reviewed, not silently accepted forever.
// Suppressing a specific, expiring, reasoned finding is the only
// sanctioned way to quiet this gate — never lowering --audit-level and
// never disabling the job.
import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.dirname(path.dirname(path.dirname(fileURLToPath(import.meta.url))));
const allowlistPath = path.join(repoRoot, ".github", "audit-allowlist.json");
const HIGH_SEVERITIES = new Set(["high", "critical"]);
const GHSA_RE = /GHSA-[a-zA-Z0-9-]+/;

function todayISO() {
  return new Date().toISOString().slice(0, 10);
}

async function loadAllowlist() {
  const raw = await readFile(allowlistPath, "utf8");
  const { entries } = JSON.parse(raw);
  const byId = new Map();
  for (const entry of entries) {
    if (byId.has(entry.id)) {
      throw new Error(`Duplicate allowlist entry for ${entry.id} in ${allowlistPath}`);
    }
    byId.set(entry.id, entry);
  }
  return byId;
}

function runAudit() {
  // npm audit exits non-zero whenever any vulnerability exists, so
  // capture stdout regardless of exit code rather than letting execSync
  // throw away the JSON on a non-zero exit.
  try {
    return execSync("npm audit --json", { cwd: repoRoot, maxBuffer: 1024 * 1024 * 32 }).toString();
  } catch (err) {
    if (err.stdout) return err.stdout.toString();
    throw err;
  }
}

// A finding's own `via` array mixes plain package-name strings (pointers
// deeper into the chain, already covered by their own top-level entry)
// with advisory objects carrying a `url` this repo can extract a GHSA id
// from. Collect whichever advisory ids this specific top-level finding
// actually cites.
function advisoryIdsFor(vuln) {
  const ids = new Set();
  for (const via of vuln.via ?? []) {
    if (typeof via === "string") continue;
    const match = GHSA_RE.exec(via.url ?? "");
    if (match) ids.add(match[0]);
  }
  return ids;
}

async function main() {
  const allowlist = await loadAllowlist();
  const today = todayISO();

  let failed = false;

  for (const [id, entry] of allowlist) {
    if (entry.expiresAt < today) {
      console.error(`::error::Allowlist entry ${id} (${entry.package}) expired ${entry.expiresAt} — re-review docs/TRACKING.md's finding and either renew with a new expiresAt or confirm it's actually fixed and remove the entry.`);
      failed = true;
    }
  }

  const auditJson = runAudit();
  const audit = JSON.parse(auditJson);
  const vulnerabilities = audit.vulnerabilities ?? {};

  const unaccepted = [];
  const accepted = [];

  for (const [pkg, vuln] of Object.entries(vulnerabilities)) {
    if (!HIGH_SEVERITIES.has(vuln.severity)) continue;
    const ids = advisoryIdsFor(vuln);
    if (ids.size === 0) {
      // A high/critical finding with no advisory object of its own (pure
      // pointer into a deeper package) — nothing to allowlist against,
      // treat as unaccepted so it's never silently swallowed.
      unaccepted.push({ pkg, severity: vuln.severity, ids: ["(no advisory id found)"] });
      continue;
    }
    const uncovered = [...ids].filter((gid) => {
      const entry = allowlist.get(gid);
      return !entry || entry.expiresAt < today;
    });
    if (uncovered.length > 0) {
      unaccepted.push({ pkg, severity: vuln.severity, ids: uncovered });
    } else {
      accepted.push({ pkg, severity: vuln.severity, ids: [...ids] });
    }
  }

  if (accepted.length > 0) {
    console.log("Accepted (allowlisted, not expired):");
    for (const { pkg, severity, ids } of accepted) {
      console.log(`  ${pkg} (${severity}) — ${ids.join(", ")}`);
    }
  }

  if (unaccepted.length > 0) {
    console.error("\n::error::High/critical findings not covered by a valid allowlist entry:");
    for (const { pkg, severity, ids } of unaccepted) {
      console.error(`  ${pkg} (${severity}) — ${ids.join(", ")}`);
    }
    console.error("\nEither fix it, or add a reasoned, expiring entry to .github/audit-allowlist.json (see docs/DECISIONS.md's audit-allowlist ADR).");
    failed = true;
  } else if (accepted.length === 0) {
    console.log("No high/critical findings.");
  }

  if (failed) process.exitCode = 1;
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
