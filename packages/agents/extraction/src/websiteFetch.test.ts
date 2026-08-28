import assert from "node:assert/strict";
import { test } from "node:test";
import { fetchWebsiteText, isPrivateOrReservedIp, UnsafeWebsiteUrlError, WebsiteFetchFailedError, WebsiteFetchTimeoutError } from "./websiteFetch.js";

test("isPrivateOrReservedIp: rejects RFC1918 private ranges", () => {
  assert.equal(isPrivateOrReservedIp("10.0.0.1"), true);
  assert.equal(isPrivateOrReservedIp("172.16.0.1"), true);
  assert.equal(isPrivateOrReservedIp("172.31.255.255"), true);
  assert.equal(isPrivateOrReservedIp("192.168.1.1"), true);
});

test("isPrivateOrReservedIp: rejects loopback and link-local, including the cloud metadata address", () => {
  assert.equal(isPrivateOrReservedIp("127.0.0.1"), true);
  assert.equal(isPrivateOrReservedIp("169.254.169.254"), true); // AWS/GCP/Azure metadata endpoint
  assert.equal(isPrivateOrReservedIp("::1"), true);
  assert.equal(isPrivateOrReservedIp("fe80::1"), true);
});

test("isPrivateOrReservedIp: rejects an IPv4-mapped IPv6 address whose embedded IPv4 is private", () => {
  assert.equal(isPrivateOrReservedIp("::ffff:127.0.0.1"), true);
  assert.equal(isPrivateOrReservedIp("::ffff:169.254.169.254"), true);
});

test("isPrivateOrReservedIp: allows real public addresses", () => {
  assert.equal(isPrivateOrReservedIp("93.184.216.34"), false); // example.com, a stable public IP
  assert.equal(isPrivateOrReservedIp("8.8.8.8"), false);
});

test("isPrivateOrReservedIp: fails closed on malformed input", () => {
  assert.equal(isPrivateOrReservedIp("not-an-ip"), true);
  assert.equal(isPrivateOrReservedIp(""), true);
});

test("fetchWebsiteText: rejects a non-http(s) scheme before ever calling fetch", async () => {
  let fetchCalled = false;
  await assert.rejects(
    () =>
      fetchWebsiteText("file:///etc/passwd", {
        timeoutMs: 1000,
        fetchImpl: (() => {
          fetchCalled = true;
          throw new Error("must not be called");
        }) as never,
      }),
    UnsafeWebsiteUrlError,
  );
  assert.equal(fetchCalled, false);
});

test("fetchWebsiteText: rejects a literal private IP in the URL before ever calling fetch or DNS", async () => {
  let fetchCalled = false;
  let dnsCalled = false;
  await assert.rejects(
    () =>
      fetchWebsiteText("http://169.254.169.254/latest/meta-data/", {
        timeoutMs: 1000,
        fetchImpl: (() => {
          fetchCalled = true;
          throw new Error("must not be called");
        }) as never,
        dnsLookup: (async () => {
          dnsCalled = true;
          throw new Error("must not be called");
        }) as never,
      }),
    UnsafeWebsiteUrlError,
  );
  assert.equal(fetchCalled, false);
  assert.equal(dnsCalled, false);
});

test("fetchWebsiteText: rejects a hostname that resolves to a private address via DNS", async () => {
  await assert.rejects(
    () =>
      fetchWebsiteText("http://internal.example.invalid/", {
        timeoutMs: 1000,
        dnsLookup: (async () => [{ address: "10.0.0.5", family: 4 }]) as never,
        fetchImpl: (() => {
          throw new Error("must not be called — DNS should have rejected first");
        }) as never,
      }),
    UnsafeWebsiteUrlError,
  );
});

test("fetchWebsiteText: re-validates a redirect hop, rejecting one that lands on a private address", async () => {
  let calls = 0;
  const fetchImpl = (async (input: URL) => {
    calls += 1;
    if (calls === 1) {
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/secret" } });
    }
    throw new Error(`must not fetch a second real hop for ${input}`);
  }) as never;

  await assert.rejects(
    () =>
      fetchWebsiteText("http://public.example.invalid/", {
        timeoutMs: 1000,
        dnsLookup: (async () => [{ address: "93.184.216.34", family: 4 }]) as never,
        fetchImpl,
      }),
    UnsafeWebsiteUrlError,
  );
  assert.equal(calls, 1);
});

test("fetchWebsiteText: gives up after too many redirects", async () => {
  const fetchImpl = (async () =>
    new Response(null, { status: 302, headers: { location: "http://public.example.invalid/next" } })) as never;

  await assert.rejects(
    () =>
      fetchWebsiteText("http://public.example.invalid/", {
        timeoutMs: 1000,
        dnsLookup: (async () => [{ address: "93.184.216.34", family: 4 }]) as never,
        fetchImpl,
      }),
    WebsiteFetchFailedError,
  );
});

test("fetchWebsiteText: rejects a non-2xx response", async () => {
  const fetchImpl = (async () => new Response("not found", { status: 404 })) as never;
  await assert.rejects(
    () =>
      fetchWebsiteText("http://public.example.invalid/", {
        timeoutMs: 1000,
        dnsLookup: (async () => [{ address: "93.184.216.34", family: 4 }]) as never,
        fetchImpl,
      }),
    WebsiteFetchFailedError,
  );
});

test("fetchWebsiteText: strips scripts/styles/tags and decodes entities into plain visible text", async () => {
  const html =
    "<html><head><style>body{color:red}</style></head><body>" +
    "<script>alert('x')</script>" +
    "<h1>Acme &amp; Co</h1><p>We sell candles &mdash; handmade.</p>" +
    "</body></html>";
  const fetchImpl = (async () =>
    new Response(html, { status: 200, headers: { "content-type": "text/html" } })) as never;

  const result = await fetchWebsiteText("http://public.example.invalid/", {
    timeoutMs: 1000,
    dnsLookup: (async () => [{ address: "93.184.216.34", family: 4 }]) as never,
    fetchImpl,
  });

  assert.ok(!result.text.includes("alert"));
  assert.ok(!result.text.includes("color:red"));
  assert.ok(result.text.includes("Acme & Co"));
  assert.ok(result.text.includes("We sell candles"));
});

test("fetchWebsiteText: rejects a response whose content-type isn't a readable page", async () => {
  const fetchImpl = (async () =>
    new Response(new Uint8Array([1, 2, 3]), { status: 200, headers: { "content-type": "application/pdf" } })) as never;
  await assert.rejects(
    () =>
      fetchWebsiteText("http://public.example.invalid/", {
        timeoutMs: 1000,
        dnsLookup: (async () => [{ address: "93.184.216.34", family: 4 }]) as never,
        fetchImpl,
      }),
    WebsiteFetchFailedError,
  );
});

test("fetchWebsiteText: times out rather than hanging on a fetch that never resolves", async () => {
  // A real fetch() rejects when its signal aborts — this fake does the same,
  // so the promise genuinely settles instead of leaking past the test (the
  // underlying bug this test itself used to trigger).
  const fetchImpl = ((_url: URL, init: { signal: AbortSignal }) =>
    new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(init.signal.reason));
    })) as never;
  await assert.rejects(
    () =>
      fetchWebsiteText("http://public.example.invalid/", {
        timeoutMs: 20,
        dnsLookup: (async () => [{ address: "93.184.216.34", family: 4 }]) as never,
        fetchImpl,
      }),
    WebsiteFetchTimeoutError,
  );
});
