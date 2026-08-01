// Regenerates just the onboarding batch for charts where it's currently
// null (diagnosing/retrying the haiku truncation issue), reusing the
// already-assembled chart — no re-spend on customize/category-validate.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { generateOnboardingBatch } from "../packages/agents/extraction/src/onboardingBatch.js";
import type { OrgChart, InterviewAnswers } from "../packages/agents/extraction/src/types.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
loadEnv({ path: join(repoRoot, ".env") });

const apiKey = process.env.ANTHROPIC_API_KEY!;
const resultsDir = join(repoRoot, "test", "results");
const targets = process.argv.slice(2);

async function main() {
  for (const fixtureName of targets) {
    const resultPath = join(resultsDir, `${fixtureName}.json`);
    const chart = JSON.parse(readFileSync(resultPath, "utf-8")) as OrgChart;
    const fixtureFile = JSON.parse(readFileSync(join(repoRoot, "test", "fixtures", `${fixtureName}.json`), "utf-8")) as {
      idea: string;
      answers: InterviewAnswers;
    };

    console.error(`Regenerating onboarding batch for ${fixtureName}...`);
    const { batch, usage } = await generateOnboardingBatch(chart, fixtureFile.idea, fixtureFile.answers, apiKey, 0.25);

    chart.onboardingBatch = batch;
    chart.meta.calls.push(usage);
    chart.meta.costUsd = chart.meta.calls.reduce((sum, c) => sum + c.costUsd, 0);

    writeFileSync(resultPath, JSON.stringify(chart, null, 2));
    console.error(`  -> $${usage.costUsd.toFixed(4)} | new total cost $${chart.meta.costUsd.toFixed(4)}`);
  }
}

main();
