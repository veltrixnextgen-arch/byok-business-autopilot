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

  // Root cause of three false failures (2026-08-08), corrected. Two
  // separate bugs, both in this check, neither in dashboard.tsx or
  // apiClient.ts:
  //
  // 1. Cookie injection (original version): the API-origin session
  //    cookie was written straight into the browser's cookie jar
  //    (page.context().addCookies()), then checked via a fresh
  //    page.goto("/dashboard") — a full page load, which runs beforeLoad
  //    server-side. A cookie sitting in the browser's jar for Railway's
  //    domain is never part of the browser's own outgoing request to
  //    Vercel, so server-side code has no way to see it. Confirmed live:
  //    the landed URL was "/login" and authClient.getSession() never
  //    even dispatched a request server-side.
  //
  // 2. Session mismatch (first "real sign-in" attempt): switched to
  //    signing in through the actual login form — correct instinct, but
  //    organization/create + organization/set-active were still called
  //    over the API using the *signup* response's session cookie. Each
  //    sign-in issues a brand-new session; the browser's real,
  //    UI-established session was never the one that got an active org.
  //    Confirmed live: sign-in returned 200, get-session returned 200,
  //    and the browser landed on /onboarding — correctly, since *that*
  //    session genuinely had no active org yet.
  //
  // Fixed for real: sign in through the form, then fill and submit the
  // *actual onboarding form* too, rather than pre-creating the org over
  // the API at all. OnboardingScreen.tsx's own create + setActive calls
  // are guaranteed to run against whatever session the browser is
  // currently holding.
  await page.goto(`${webUrl}/login`, { waitUntil: "networkidle", timeout: 30000 });
  await page.locator("#email").fill(email);
  await page.locator("#password").fill(password);
  await page.getByRole("button", { name: /^sign in$/i }).click();

  await page.getByPlaceholder(/acme studio/i).waitFor({ state: "visible", timeout: 15000 });
  await page.getByPlaceholder(/acme studio/i).fill(`Verify styled ${stamp}`);
  await page.getByRole("button", { name: /^create company$/i }).click();

  // R2 (ADR-024): OnboardingScreen's post-success navigate no longer goes
  // straight to /dashboard — it goes to /charter (loadIdea() is null for
  // this disposable account, which never visits /interview), and a fresh
  // account with no claimed org chart lands on CharterScreen's "empty"
  // state, which never navigates onward on its own. Waiting for the URL
  // to leave /onboarding confirms org creation itself succeeded (that's
  // what OnboardingScreen's own submit handler awaits before navigating
  // anywhere).
  await page.waitForURL((url) => !url.pathname.includes("/onboarding"), { timeout: 15000 });

  // NOT a page.goto: issue #118, confirmed live on staging — every
  // authenticated route's beforeLoad checks the session via an SSR fetch
  // (serverAuthHeaders.ts forwarding the incoming request's own Cookie
  // header), and that can never work for a cross-site cookie (staging's
  // session cookie is scoped to Railway's origin; a request TO Vercel can
  // never carry it, regardless of SameSite/Partitioned). A hard reload of
  // ANY protected route — not just /dashboard — bounces to /login even
  // with a fully valid session. Clicking AppShell's own "Dashboard" nav
  // link (AppShell.tsx's NAV_ITEMS) is a real client-side router
  // transition, exactly how a real user reaches this page, and sidesteps
  // the bug entirely rather than tripping over it.
  const meResponsePromise = page.waitForResponse((res) => new URL(res.url()).pathname === "/me", { timeout: 15000 });
  await page.getByRole("link", { name: "Dashboard", exact: true }).click();

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
  // The heading renders synchronously on mount; the Card only appears
  // once dashboard.tsx's own useEffect (a GET /me) resolves — confirmed
  // live (2026-08-08) via Railway's HTTP logs: /me genuinely dispatches
  // and would resolve normally, but checking with zero wait caught it
  // mid-flight and this script's own browser.close() aborted it (a 499
  // in the logs). Waiting for that specific real response — not an
  // arbitrary poll — removes the guesswork: if /me never resolves for a
  // real reason, this still fails, honestly, on a real timeout.
  const meResponse = await meResponsePromise;
  console.log(`  /me responded ${meResponse.status()} ✓`);

  // The response resolving doesn't guarantee React has committed the
  // resulting setMe(...) re-render yet (res.json() itself is another
  // microtask, then React's own commit) — waitForFunction polls the DOM
  // until the condition is true or the bounded timeout elapses, rather
  // than checking once immediately after a promise most of one render
  // cycle away from actually being reflected.
  const cardStyled = await page
    .waitForFunction(
      () => {
        const els = [...document.querySelectorAll("div")];
        return els.some((el) => {
          const cs = getComputedStyle(el);
          const radius = Number.parseFloat(cs.borderRadius);
          return radius > 0 && cs.backgroundColor.startsWith("rgba") && !cs.backgroundColor.endsWith(", 0)");
        });
      },
      { timeout: 2000 },
    )
    .then(() => true)
    .catch(() => false);
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
