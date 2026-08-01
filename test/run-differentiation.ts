// MVP-0 differentiation test runner (master-plan-v2.md §5): runs the three
// canonical prompts from the role catalog through the extraction pipeline
// and writes each org chart to test/results/, plus a total-cost summary.
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
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

const fixtureFiles = readdirSync(fixturesDir).filter((f) => f.endsWith(".json"));

async function main() {
  let totalCost = 0;
  const summary: { fixture: string; costUsd: number; template: string; status: "ok" | "failed"; error?: string }[] = [];

  for (const file of fixtureFiles) {
    const fixture = JSON.parse(readFileSync(join(fixturesDir, file), "utf-8")) as {
      idea: string;
      answers: InterviewAnswers;
    };

    console.error(`Running: ${fixture.idea}`);

    // One fixture's failure (e.g. a Hands-scope-separation violation) must
    // not abort the whole batch — record it and keep going, so the report
    // still covers every fixture that DID succeed.
    try {
      const chart = await extractOrgChart(fixture.idea, fixture.answers, { apiKey: apiKey! });

      const outName = basename(file, ".json") + ".json";
      writeFileSync(join(resultsDir, outName), JSON.stringify(chart, null, 2));

      totalCost += chart.meta.costUsd;
      summary.push({ fixture: file, costUsd: chart.meta.costUsd, template: chart.meta.templateSelection.primary, status: "ok" });
      console.error(`  -> ${outName} | template=${chart.meta.templateSelection.primary} | $${chart.meta.costUsd.toFixed(4)}`);
    } catch (err) {
      const message = (err as Error).message;
      summary.push({ fixture: file, costUsd: 0, template: "", status: "failed", error: message });
      console.error(`  -> FAILED: ${message}`);
    }
  }

  console.error("\n=== Differentiation test run summary ===");
  for (const s of summary) {
    console.error(s.status === "ok" ? `${s.fixture}: template=${s.template}, cost=$${s.costUsd.toFixed(4)}` : `${s.fixture}: FAILED — ${s.error}`);
  }
  console.error(`Total API cost: $${totalCost.toFixed(4)}`);

  writeFileSync(
    join(resultsDir, "run-summary.json"),
    JSON.stringify({ runs: summary, totalCostUsd: totalCost, generatedAt: new Date().toISOString() }, null, 2),
  );
}

main();
