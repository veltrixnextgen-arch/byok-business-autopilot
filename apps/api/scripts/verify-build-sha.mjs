#!/usr/bin/env node
// ADR-029: self-reporting build verification.
//
// Replaces a Railway-CLI-based check ("is the actively-serving deployment
// fresh, per `railway status --json`'s own record of itself") that failed
// three consecutive staging deploys (v0.6.21, v0.6.22, v0.6.23) in three
// different ways, after already having been rewritten twice before that
// for two earlier failure modes (see deploy-staging.yml's own history).
// Root cause common to every version: it asked the PLATFORM to describe
// its own deployment record, and that record is unreliable specifically
// for the `railway up`-based CLI-upload deploy path this workflow uses —
// PR #133 already found that path doesn't reliably populate commit-hash
// metadata a native git-webhook deploy would. Asking the RUNNING PROCESS
// what it thinks it is, instead, works regardless of deploy mechanism,
// Railway CLI version, or Railway's own API/JSON shape — the running
// server either reports the commit it was built from, or it doesn't.
//
// Usage: node verify-build-sha.mjs <health-url> <expected-sha> [maxAttempts] [sleepMs]
//
// Polls <health-url>, parses its JSON body, and asserts the `buildSha`
// field matches <expected-sha> EXACTLY. Exits 0 the moment it matches;
// exits 1 (printing the last-seen value) if it never does within
// maxAttempts. A build that never sets BUILD_SHA reports "unknown", which
// will never match a real commit sha — the check fails loud in that case
// too, rather than silently passing on an unset field.
const [, , healthUrl, expectedSha, maxAttemptsArg, sleepMsArg] = process.argv;
if (!healthUrl || !expectedSha) {
  console.error("Usage: node verify-build-sha.mjs <health-url> <expected-sha> [maxAttempts] [sleepMs]");
  process.exitCode = 2;
} else {
  await run(healthUrl, expectedSha, Number(maxAttemptsArg ?? 30), Number(sleepMsArg ?? 10_000));
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Sets process.exitCode and returns, rather than calling process.exit()
// directly — letting the event loop drain naturally avoids a race between
// fetch()'s (undici's) open keep-alive socket handles and an abrupt exit,
// which crashes with a libuv assertion on some platforms/Node versions if
// exit() is called while a handle is still mid-close.
async function run(url, expected, maxAttempts, sleepMs) {
  let lastSeen = "<unreachable>";
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const res = await fetch(url);
      if (res.ok) {
        const body = await res.json();
        lastSeen = body.buildSha ?? "<missing buildSha field>";
        if (lastSeen === expected) {
          console.log(`Confirmed: ${url} reports buildSha=${lastSeen}, matching the expected ${expected}.`);
          return;
        }
      } else {
        lastSeen = `<HTTP ${res.status}>`;
      }
    } catch (err) {
      lastSeen = `<fetch error: ${err.message}>`;
    }
    console.log(`Not yet matching (attempt ${attempt}/${maxAttempts}): ${url} reports buildSha=${lastSeen}, expected ${expected}...`);
    if (attempt < maxAttempts) await sleep(sleepMs);
  }

  console.error(`::error::${url} never reported buildSha matching "${expected}" (last seen: ${lastSeen}) after ${maxAttempts} attempts.`);
  process.exitCode = 1;
}
