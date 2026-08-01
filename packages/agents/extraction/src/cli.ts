#!/usr/bin/env node
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { config as loadEnv } from "dotenv";
import { Command } from "commander";
import { extractOrgChart } from "./pipeline.js";
import { printTree } from "./treePrinter.js";
import { CostGuardError } from "./costGuard.js";
import type { InterviewAnswers } from "./types.js";

// This package lives at packages/agents/extraction — .env lives at the repo
// root regardless of which directory `extract` is invoked from (npm
// workspaces run scripts with cwd set to the package, not the root).
const __dirname = dirname(fileURLToPath(import.meta.url));
loadEnv({ path: resolve(__dirname, "../../../../.env") });

const program = new Command();

program
  .name("extract")
  .description("BYOK Business Autopilot — Task Extraction Engine v1 (MVP-0)")
  .requiredOption("--idea <text>", "The business idea, in the user's own words")
  .requiredOption("--answers <path>", "Path to a JSON file with the 6 interview answers")
  .option("--out <path>", "Write the org chart JSON to this path")
  .option("--max-cost <usd>", "Hard cost cap for the customize pass (default 0.25)", parseFloat)
  .action(async (options) => {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      console.error("ANTHROPIC_API_KEY is not set. Add it to .env (see .env.example).");
      process.exitCode = 1;
      return;
    }

    let answers: InterviewAnswers;
    try {
      answers = JSON.parse(readFileSync(options.answers, "utf-8"));
    } catch (err) {
      console.error(`Could not read/parse --answers file at ${options.answers}: ${(err as Error).message}`);
      process.exitCode = 1;
      return;
    }

    try {
      const chart = await extractOrgChart(options.idea, answers, {
        apiKey,
        maxCostUsd: options.maxCost,
      });

      console.log(printTree(chart));
      console.log("");
      console.log(JSON.stringify(chart, null, 2));

      if (options.out) {
        mkdirSync(dirname(options.out), { recursive: true });
        writeFileSync(options.out, JSON.stringify(chart, null, 2));
        console.error(`\nWrote org chart to ${options.out}`);
      }
    } catch (err) {
      if (err instanceof CostGuardError) {
        console.error(`Cost guard tripped: ${err.message}`);
        process.exitCode = 1;
        return;
      }
      throw err;
    }
  });

program.parseAsync();
