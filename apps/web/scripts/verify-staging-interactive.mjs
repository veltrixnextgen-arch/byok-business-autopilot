#!/usr/bin/env node
// Caught live 2026-08-03 (docs/DECISIONS.md ADR-016, issue #39): a broken
// deploy returned HTTP 200 with zero console errors while being
// completely non-interactive — typing into the idea box never revealed
// the submit button, clicking "Sign in" did nothing. A status-code smoke
// check cannot tell a healthy page from a dead one that merely rendered
// its initial HTML. This script actually drives the page: load it, type
// into the idea input, and assert the submit button this reveals is real
// — the same one-line interaction a real visitor performs first.
import { chromium } from "playwright";

const url = process.argv[2];
if (!url) {
  console.error("Usage: node verify-staging-interactive.mjs <url>");
  process.exit(1);
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });

  // The landing page has had two idea-input textareas since the landing
  // redesign (PR #67) — hero and the final-CTA section, both wired to the
  // same submit logic. `.first()` targets the hero one specifically; a
  // bare `page.locator("textarea")` throws a Playwright strict-mode
  // violation the instant there's more than one match on the page.
  const idea = page.locator("textarea").first();
  await idea.waitFor({ state: "visible", timeout: 10000 });
  await idea.fill("Interactivity check: a mobile pet-grooming business");

  const submit = page.getByRole("button", { name: /meet your company/i });
  await submit.waitFor({ state: "visible", timeout: 10000 });

  if (consoleErrors.length > 0) {
    console.error("::error::apps/web is interactive but logged console errors:");
    for (const e of consoleErrors) console.error(`  ${e}`);
    process.exitCode = 1;
  } else {
    console.log(`apps/web at ${url} is interactive: typing revealed the submit button, no console errors.`);
  }
} catch (err) {
  console.error(`::error::apps/web at ${url} failed the interactivity check: ${err.message}`);
  console.error("This is exactly the failure mode a plain HTTP-status check misses — the page can return 200 with zero console errors while being completely dead.");
  process.exitCode = 1;
} finally {
  await browser.close();
}
