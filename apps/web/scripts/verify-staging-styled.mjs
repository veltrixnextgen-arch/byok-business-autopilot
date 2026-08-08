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

  // Pre-create the org over the API (this part was never in question —
  // organization/create and organization/set-active both return real
  // 200s here every time). What changed is HOW the browser itself gets a
  // session: not anymore.
  const orgRes = await fetch(`${apiUrl}/api/auth/organization/create`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: webUrl, Cookie: cookiePair },
    body: JSON.stringify({ name: `Verify styled ${stamp}`, slug: `verify-styled-${stamp}` }),
  });
  if (!orgRes.ok) {
    throw new Error(`Could not create an organization for the /dashboard check (HTTP ${orgRes.status}).`);
  }
  const org = await orgRes.json();

  const setActiveRes = await fetch(`${apiUrl}/api/auth/organization/set-active`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: webUrl, Cookie: cookiePair },
    body: JSON.stringify({ organizationId: org.id }),
  });
  if (!setActiveRes.ok) {
    throw new Error(`Could not set the organization active for the /dashboard check (HTTP ${setActiveRes.status}).`);
  }

  // Root cause of two false failures (2026-08-08), corrected: this check
  // used to inject the API-origin session cookie directly into the
  // browser's cookie jar (page.context().addCookies()) and then do a
  // fresh page.goto("/dashboard") — a full page load, which runs
  // beforeLoad server-side. A cookie added to the browser's jar for
  // Railway's domain is never part of the browser's own outgoing request
  // to Vercel, so server-side code has no way to see it; confirmed live
  // (page.url() after that navigation was actually "/login", and
  // authClient.getSession() never even dispatched a request server-side).
  // That first "the /me fetch never dispatches" finding was itself an
  // artifact of this same setup, not a real dashboard.tsx bug — record
  // corrected here, not left sitting in docs/TRACKING.md as if it were.
  //
  // Fixed for real: sign in through the actual login form, the same path
  // a real user takes. This makes signIn.email() (a genuine cross-site
  // fetch from inside the page) the one establishing the cookie — the
  // browser's own fetch naturally stores whatever Set-Cookie it gets back
  // for that origin, no manual injection needed — and login.tsx's
  // post-success `navigate({ to: "/dashboard" })` is a client-side router
  // transition, not a fresh page load, so beforeLoad runs in the
  // already-hydrated browser with a session it can actually see.
  await page.goto(`${webUrl}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();

  const dashboardHeading = page.getByRole("heading", { name: /^dashboard$/i });
  await dashboardHeading.waitFor({ state: "visible", timeout: 15000 });
  const fontFamily = await dashboardHeading.evaluate((el) => getComputedStyle(el).fontFamily);
  if (!fontFamily.includes(DISPLAY_FONT)) {
    throw new Error(
      `/dashboard: heading font-family is "${fontFamily}", expected it to include "${DISPLAY_FONT}" — the design tokens aren't reaching this page's heading.`,
    );
  }
  console.log(`  heading font-family includes "${DISPLAY_FONT}" ✓`);

  // Dashboard is deliberately minimal (STEP 8 builds it out for real) — no
  // gradient CTA is expected there, so this checks its Card container
  // instead: a real, non-zero border-radius and a translucent (not fully
  // transparent, not opaque black) background, both of which only come
  // from the `Card` component's own classes, never from browser defaults.
  //
  // No poll here on purpose (PR #79's 4.5s poll was reverted, not kept in
  // any form) — it was built on a latency theory two rounds of real
  // evidence disproved. If this fails now, it fails for a reason worth
  // seeing immediately, not one worth waiting out.
  const cardStyled = await page.evaluate(() => {
    const els = [...document.querySelectorAll("div")];
    return els.some((el) => {
      const cs = getComputedStyle(el);
      const radius = Number.parseFloat(cs.borderRadius);
      return radius > 0 && cs.backgroundColor.startsWith("rgba") && !cs.backgroundColor.endsWith(", 0)");
    });
  });
  if (!cardStyled) {
    throw new Error("/dashboard: no element has a rounded, translucent card background — expected the Card component's styling to be present.");
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
