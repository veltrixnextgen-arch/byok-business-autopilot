// MVP-0 differentiation test runner (master-plan-v2.md §5): runs every
// fixture in test/fixtures/ through the extraction pipeline and writes each
// org chart to test/results/, plus a running cost summary.
//
// Resumable by design: test/results/run-state.json is written after EVERY
// fixture (success or failure), not just at the end. If the process dies
// mid-batch — e.g. the provider billing error that killed a run here — a
// second invocation reads that state, skips fixtures already marked "ok"
// (no re-spend), and only (re)attempts what's pending or previously
// failed. This is the same pause/resume shape production will need when a
// USER's own key runs dry mid-batch: agents should pause and pick back up,
// not lose completed work and redo it from scratch. Pass --fresh to ignore
// existing state and rerun everything (e.g. after a prompt/template change).
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from "node:fs";
import { dirname, resolve, join, basename } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { extractOrgChart } from "../packages/agents/extraction/src/pipeline.js";
import type { InterviewAnswers } from "../packages/agents/extraction/src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
loadEnv({ path: join(repoRoot, ".env") });

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error("ANTHROPIC_API_KEY is not set in .env");
  process.exit(1);
}

const fixturesDir = join(repoRoot, "test", "fixtures");
const resultsDir = join(repoRoot, "test", "results");
mkdirSync(resultsDir, { recursive: true });

const stateFilePath = join(resultsDir, "run-state.json");
const fresh = process.argv.includes("--fresh");

interface FixtureRunState {
  status: "ok" | "failed";
  costUsd: number;
  template?: string;
  error?: string;
  completedAt: string;
}

interface RunState {
  startedAt: string;
  updatedAt: string;
  runs: Record<string, FixtureRunState>;
}

function loadState(): RunState {
  if (!fresh && existsSync(stateFilePath)) {
    try {
      return JSON.parse(readFileSync(stateFilePath, "utf-8")) as RunState;
    } catch {
      console.error(`[resume] Could not parse existing ${stateFilePath} — starting fresh.`);
    }
  }
  return { startedAt: new Date().toISOString(), updatedAt: new Date().toISOString(), runs: {} };
}

function persistState(state: RunState) {
  state.updatedAt = new Date().toISOString();
  writeFileSync(stateFilePath, JSON.stringify(state, null, 2));
}

const fixtureFiles = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));

async function main() {
  const state = loadState();
  const alreadyDone = Object.entries(state.runs).filter(([, r]) => r.status === "ok").length;
  if (alreadyDone > 0) {
    console.error(`[resume] Found existing state: ${alreadyDone}/${fixtureFiles.length} fixture(s) already completed. Skipping those.`);
  }

  for (const file of fixtureFiles) {
    const existing = state.runs[file];
    if (existing?.status === "ok") {
      console.error(`Skipping (already completed): ${file} | template=${existing.template} | $${existing.costUsd.toFixed(4)}`);
      continue;
    }

    const fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf-8")) as {
      idea: string;
      answers: InterviewAnswers;
    };

    console.error(`Running: ${fixture.idea}`);

    // One fixture's failure (e.g. a Hands-scope-separation violation, or a
    // provider billing error) must not abort the whole batch or lose
    // whatever already succeeded — record it, persist state immediately,
    // and keep going.
    try {
      const chart = await extractOrgChart(fixture.idea, fixture.answers, { apiKey: apiKey! });

      const outName = basename(file, ".json") + ".json";
      writeFileSync(join(resultsDir, outName), JSON.stringify(chart, null, 2));

      state.runs[file] = {
        status: "ok",
        costUsd: chart.meta.costUsd,
        template: chart.meta.templateSelection.primary,
        completedAt: new Date().toISOString(),
      };
      console.error(`  -> ${outName} | template=${chart.meta.templateSelection.primary} | $${chart.meta.costUsd.toFixed(4)}`);
    } catch (err) {
      const message = (err as Error).message;
      state.runs[file] = { status: "failed", costUsd: 0, error: message, completedAt: new Date().toISOString() };
      console.error(`  -> FAILED: ${message}`);
    }

    persistState(state); // after EVERY fixture, not just at the end
  }

  const totalCost = Object.values(state.runs).reduce((sum, r) => sum + r.costUsd, 0);

  console.error("\n=== Differentiation test run summary ===");
  for (const [file, r] of Object.entries(state.runs)) {
    console.error(r.status === "ok" ? `${file}: template=${r.template}, cost=$${r.costUsd.toFixed(4)}` : `${file}: FAILED — ${r.error}`);
  }
  console.error(`Total API cost: $${totalCost.toFixed(4)}`);

  const failedCount = Object.values(state.runs).filter((r) => r.status === "failed").length;
  if (failedCount > 0) {
    console.error(`\n${failedCount} fixture(s) still failing. Rerun this script (without --fresh) to resume — completed fixtures won't be re-spent.`);
  }
}

main();
