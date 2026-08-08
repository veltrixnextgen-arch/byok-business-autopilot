#!/usr/bin/env node
// Extends verify-staging-interactive.mjs's lesson (issue #39, ADR-016) one
// step further: a page can be interactive AND still be broken — the
// /login regression this script exists to catch was a 200-returning,
// fully-functional, zero-console-error page that rendered as unstyled
// 1995 HTML (raw form elements, no layout, no visible input boxes). Bare
// interactivity can't tell that apart from a real page; this asserts the
// design tokens actually reached the DOM as computed styles.
import { chromium } from "playwright";

const webUrl = process.argv[2];
const apiUrl = process.argv[3];
if (!webUrl || !apiUrl) {
  console.error("Usage: node verify-staging-styled.mjs <webUrl> <apiUrl>");
  process.exit(1);
}

const DISPLAY_FONT = "Space Grotesk";

// An unstyled heading still inherits the body's own font (Hanken Grotesk,
// set globally via `body { font-family: var(--font-body) }`) — NOT the
// browser's serif default. Checking against "not Times New Roman" would
// therefore miss the bug this script exists to catch. The real signal is
// the *display* font: only an explicitly-styled heading (the `font-display`
// class, Space Grotesk) ever gets it — inheritance from body can't produce
// it, so this is proof the page's own classes are actually applying, not
// just that the stylesheet downloaded.
async function assertHeadingUsesDisplayFont(page, path) {
  await page.goto(`${webUrl}${path}`, { waitUntil: "networkidle", timeout: 30000 });
  const heading = page.getByRole("heading").first();
  await heading.waitFor({ state: "visible", timeout: 10000 });
  const fontFamily = await heading.evaluate((el) => getComputedStyle(el).fontFamily);
  if (!fontFamily.includes(DISPLAY_FONT)) {
    throw new Error(
      `${path}: heading font-family is "${fontFamily}", expected it to include "${DISPLAY_FONT}" — the design tokens aren't reaching this page's heading.`,
    );
  }
  console.log(`  heading font-family includes "${DISPLAY_FONT}" ✓`);
}

// A browser never applies a gradient background to a button or link on its
// own — this only ever comes from the app's own CSS (the `gradient` Button
// variant). Checking background-image rather than background-color also
// sidesteps inheritance: unlike color/font-family, background-image is not
// an inherited CSS property, so this can only be true if the element (or a
// non-body ancestor) is actually carrying real utility classes.
async function assertHasGradientAction(page, path) {
  const hasGradient = await page.evaluate(() => {
    const els = [...document.querySelectorAll("button, a")];
    return els.some((el) => getComputedStyle(el).backgroundImage.includes("gradient"));
  });
  if (!hasGradient) {
    throw new Error(
      `${path}: no button or link on the page has a gradient background — expected at least the primary call to action to use the gradient button variant. A completely unstyled page has no background-image on any control.`,
    );
  }
  console.log("  page has a gradient-styled call to action ✓");
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage();

  for (const path of ["/", "/login", "/signup"]) {
    console.log(`Checking ${path} ...`);
    await assertHeadingUsesDisplayFont(page, path);
    await assertHasGradientAction(page, path);
  }

  // /dashboard requires a session — beforeLoad redirects to /login (then
  // /onboarding for a session with no org) without one, so a real signup +
  // org creation is the only way to actually reach and check its markup.
  // Disposable, .invalid-domain, never touched again — the same pattern
  // the "Verify signup/org creation actually works end to end" steps
  // already use elsewhere in this workflow, reused here rather than
  // duplicated with different mechanics.
  console.log("Checking /dashboard (via a disposable test account) ...");
  const stamp = Date.now();
  const email = `verify-styled-${stamp}@example.invalid`;
  const password = "Str0ngTempPassw0rd!";

  const signUpRes = await fetch(`${apiUrl}/api/auth/sign-up/email`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: webUrl },
    body: JSON.stringify({ email, password, name: "verify styled" }),
  });
  if (!signUpRes.ok) {
    throw new Error(`Could not create the disposable test account for the /dashboard check (HTTP ${signUpRes.status}).`);
  }
  const setCookieHeader = signUpRes.headers.get("set-cookie");
  if (!setCookieHeader) {
    throw new Error("Signup succeeded but returned no session cookie — cannot check /dashboard.");
  }
  const [cookiePair] = setCookieHeader.split(";");
  const [cookieName, cookieValue] = cookiePair.split("=");
  const apiOrigin = new URL(apiUrl);

  // The session cookie belongs to the API's origin, not the web app's —
  // apps/web's own fetch calls send it cross-site (this is exactly why
  // the signup-verification step elsewhere in this workflow asserts
  // SameSite=None on it). Handing it to the browser context scoped to the
  // API origin reproduces that: the page (served from webUrl) still sends
  // it on its own credentialed fetch to apiUrl when it calls
  // authClient.getSession().
  await page.context().addCookies([
    { name: cookieName, value: cookieValue, domain: apiOrigin.hostname, path: "/", secure: true, sameSite: "None" },
  ]);

  const orgRes = await fetch(`${apiUrl}/api/auth/organization/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: webUrl, Cookie: cookiePair },
    body: JSON.stringify({ name: `Verify styled ${stamp}`, slug: `verify-styled-${stamp}` }),
  });
  if (!orgRes.ok) {
    throw new Error(`Could not create an organization for the /dashboard check (HTTP ${orgRes.status}).`);
  }
  const org = await orgRes.json();

  // Root cause of a two-run false failure (2026-08-08): creating an
  // organization does NOT make it the session's active one — Better Auth
  // requires this as a separate call. OnboardingScreen.tsx already knows
  // this (it calls organization.create then organization.setActive as
  // two distinct steps); this script only did the first, so
  // dashboard.tsx's beforeLoad guard (no activeOrganizationId ->
  // /onboarding) silently redirected every run to /onboarding instead of
  // /dashboard. The check still "passed" the heading-font assertion
  // (onboarding has its own correctly-styled <h1>) while having zero
  // chance of ever finding dashboard's Card — a false failure that looked
  // exactly like a real one for two consecutive deploys.
  const setActiveRes = await fetch(`${apiUrl}/api/auth/organization/set-active`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: webUrl, Cookie: cookiePair },
    body: JSON.stringify({ organizationId: org.id }),
  });
  if (!setActiveRes.ok) {
    throw new Error(`Could not set the organization active for the /dashboard check (HTTP ${setActiveRes.status}).`);
  }

  // DIAGNOSTIC (temporary — remove once resolved): the set-active fix
  // (PR #80) confirmed 200 on the wire but the Card still never appeared.
  // Surfacing the ACTUAL landed URL (is beforeLoad redirecting somewhere
  // else again, for a different reason this time?) plus every console
  // message, page error, and API-origin response for this page.
  const apiHostname = new URL(apiUrl).hostname;
  page.on("console", (msg) => console.log(`  [dashboard console:${msg.type()}] ${msg.text()}`));
  page.on("pageerror", (err) => console.log(`  [dashboard pageerror] ${String(err)}`));
  page.on("requestfailed", (req) => console.log(`  [dashboard requestfailed] ${req.method()} ${req.url()} — ${req.failure()?.errorText}`));
  page.on("response", (res) => {
    if (res.url().includes(apiHostname)) {
      console.log(`  [dashboard response] ${res.request().method()} ${res.url()} -> ${res.status()}`);
    }
  });

  await assertHeadingUsesDisplayFont(page, "/dashboard");
  console.log(`  [dashboard] actual landed URL: ${page.url()}`);
  // Dashboard is deliberately minimal (STEP 8 builds it out for real) — no
  // gradient CTA is expected there, so this checks its Card container
  // instead: a real, non-zero border-radius and a translucent (not fully
  // transparent, not opaque black) background, both of which only come
  // from the `Card` component's own classes, never from browser defaults.
  //
  // dashboard.tsx's Card only renders once its own client-side useEffect
  // (a fetch to /me) resolves — before that the page legitimately shows
  // "Loading…", with no Card in the DOM at all. Playwright's networkidle
  // wait in assertHeadingUsesDisplayFont doesn't guarantee that fetch has
  // *finished*, only that no new requests are in flight at the moment it
  // sampled — a slower-than-usual /me response (a cold Railway instance,
  // connection-pool latency) can still be caught. Polling for a few
  // seconds tolerates that ordinary latency without weakening what the
  // check actually proves: it still fails for good if the Card's classes
  // are genuinely missing, same as before.
  const CARD_POLL_ATTEMPTS = 10;
  const CARD_POLL_INTERVAL_MS = 500;
  let cardStyled = false;
  for (let attempt = 0; attempt < CARD_POLL_ATTEMPTS && !cardStyled; attempt++) {
    if (attempt > 0) await page.waitForTimeout(CARD_POLL_INTERVAL_MS);
    cardStyled = await page.evaluate(() => {
      const els = [...document.querySelectorAll("div")];
      return els.some((el) => {
        const cs = getComputedStyle(el);
        const radius = Number.parseFloat(cs.borderRadius);
        return radius > 0 && cs.backgroundColor.startsWith("rgba") && !cs.backgroundColor.endsWith(", 0)");
      });
    });
  }
  if (!cardStyled) {
    throw new Error(
      `/dashboard: no element has a rounded, translucent card background after ${((CARD_POLL_ATTEMPTS - 1) * CARD_POLL_INTERVAL_MS) / 1000}s of polling — expected the Card component's styling to be present once /me resolves.`,
    );
  }
  console.log("  dashboard card container is styled ✓");

  console.log("All routes have the design tokens actually applied, not just downloaded.");
} catch (err) {
  console.error(`::error::Design-token check failed: ${err.message}`);
  console.error(
    "This is exactly the failure mode the plain interactivity check misses — a page can be interactive and return 200 while rendering with none of its styling applied.",
  );
  process.exitCode = 1;
} finally {
  await browser.close();
}
