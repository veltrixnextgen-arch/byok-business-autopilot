// One-off cost experiment (not part of the committed differentiation test):
// does the onboarding batch (simulated-day script + Charter draft) hold up
// on claude-haiku-4-5 instead of claude-sonnet-4-6? It's formatting/
// synthesis over an already-extracted org chart, not fresh reasoning, so
// haiku is worth testing. Reuses already-assembled charts (no re-spend on
// customize/validate) and runs generateOnboardingBatch twice per fixture.
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
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
const experimentsDir = join(resultsDir, "experiments");
mkdirSync(experimentsDir, { recursive: true });

const FIXTURES = ["mortgage-brokerage", "candle-shop"]; // one complex/compliance-heavy, one simple
const MODELS = ["claude-sonnet-4-6", "claude-haiku-4-5-20251001"];

async function main() {
  const summary: { fixture: string; model: string; costUsd: number; inputTokens: number; outputTokens: number }[] = [];

  for (const fixtureName of FIXTURES) {
    const chart = JSON.parse(readFileSync(join(resultsDir, `${fixtureName}.json`), "utf-8")) as OrgChart;
    const fixtureFile = JSON.parse(readFileSync(join(repoRoot, "test", "fixtures", `${fixtureName}.json`), "utf-8")) as {
      idea: string;
      answers: InterviewAnswers;
    };

    for (const model of MODELS) {
      console.error(`Generating onboarding batch for ${fixtureName} with ${model}...`);
      const { batch, usage } = await generateOnboardingBatch(chart, fixtureFile.idea, fixtureFile.answers, apiKey, 0.25, model);

      const outName = `${fixtureName}.${model}.json`;
      writeFileSync(join(experimentsDir, outName), JSON.stringify(batch, null, 2));
      summary.push({ fixture: fixtureName, model, costUsd: usage.costUsd, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens });
      console.error(`  -> $${usage.costUsd.toFixed(4)} (${usage.inputTokens} in / ${usage.outputTokens} out)`);
    }
  }

  console.error("\n=== Haiku vs Sonnet cost experiment ===");
  for (const s of summary) {
    console.error(`${s.fixture} | ${s.model}: $${s.costUsd.toFixed(4)}`);
  }
  writeFileSync(join(experimentsDir, "summary.json"), JSON.stringify(summary, null, 2));
}

main();
