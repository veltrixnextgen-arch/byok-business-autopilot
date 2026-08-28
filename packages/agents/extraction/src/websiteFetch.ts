import dns from "node:dns/promises";
import net from "node:net";

// Website-as-input (ADR-058): fetching a URL the USER supplies is a
// classic SSRF vector — without these checks, a signup form becomes a way
// to probe internal infrastructure (cloud metadata endpoints, internal
// services on a private network) from the platform's own server. Every
// check here runs BEFORE the connecting fetch happens, on both the
// original URL and every redirect hop it leads to — a hostname that
// resolves cleanly to a public IP on hop 1 but redirects to
// 169.254.169.254 on hop 2 is exactly the bypass this exists to close.

export class UnsafeWebsiteUrlError extends Error {}
export class WebsiteFetchTimeoutError extends Error {}
export class WebsiteFetchFailedError extends Error {}

const ALLOWED_SCHEMES = new Set(["http:", "https:"]);
const MAX_REDIRECTS = 5;
const MAX_RESPONSE_BYTES = 2_000_000; // 2MB — a marketing site's HTML, not a video file

function isPrivateOrReservedIPv4(ip: string): boolean {
  const parts = ip.split(".").map(Number);
  if (parts.length !== 4 || parts.some((p) => Number.isNaN(p))) return true; // malformed — fail closed
  const [a, b] = parts;
  if (a === 10) return true; // 10.0.0.0/8
  if (a === 127) return true; // 127.0.0.0/8 loopback
  if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local, incl. cloud metadata (169.254.169.254)
  if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12
  if (a === 192 && b === 168) return true; // 192.168.0.0/16
  if (a === 100 && b >= 64 && b <= 127) return true; // 100.64.0.0/10 carrier-grade NAT
  if (a === 0) return true; // 0.0.0.0/8
  if (a >= 224) return true; // multicast (224/4) + reserved (240/4)
  return false;
}

function isPrivateOrReservedIPv6(ip: string): boolean {
  const lower = ip.toLowerCase();
  if (lower === "::1") return true; // loopback
  if (lower === "::") return true;
  if (lower.startsWith("fc") || lower.startsWith("fd")) return true; // fc00::/7 unique local
  if (lower.startsWith("fe8") || lower.startsWith("fe9") || lower.startsWith("fea") || lower.startsWith("feb")) return true; // fe80::/10 link-local
  // IPv4-mapped (::ffff:a.b.c.d) — check the embedded IPv4 too.
  const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateOrReservedIPv4(mapped[1]);
  return false;
}

/** Exported for direct unit testing — the one function real safety
 *  depends on, so it's tested without needing to mock DNS or fetch. */
export function isPrivateOrReservedIp(ip: string): boolean {
  const version = net.isIP(ip);
  if (version === 4) return isPrivateOrReservedIPv4(ip);
  if (version === 6) return isPrivateOrReservedIPv6(ip);
  return true; // not a recognizable IP at all — fail closed
}

/** Validates scheme and resolves the hostname, rejecting anything that
 *  lands on a private/loopback/link-local address. Called once per
 *  redirect hop, never just on the original URL — see this module's own
 *  header comment for why. `dnsLookup` is injectable so tests can fake
 *  DNS resolution (a hostname resolving to an internal IP) without a real
 *  network call — defaults to the real node:dns. */
async function assertSafeToFetch(url: URL, dnsLookup: typeof dns.lookup): Promise<void> {
  if (!ALLOWED_SCHEMES.has(url.protocol)) {
    throw new UnsafeWebsiteUrlError(`"${url.protocol}" is not an allowed scheme — only http/https.`);
  }
  // A literal IP in the URL (http://169.254.169.254/) skips DNS entirely —
  // check the hostname itself before ever resolving it.
  if (net.isIP(url.hostname) && isPrivateOrReservedIp(url.hostname)) {
    throw new UnsafeWebsiteUrlError(`"${url.hostname}" resolves to a private/reserved address — refusing to fetch it.`);
  }
  if (!net.isIP(url.hostname)) {
    const addresses = await dnsLookup(url.hostname, { all: true });
    if (addresses.length === 0) {
      throw new UnsafeWebsiteUrlError(`"${url.hostname}" did not resolve to any address.`);
    }
    for (const { address } of addresses) {
      if (isPrivateOrReservedIp(address)) {
        throw new UnsafeWebsiteUrlError(`"${url.hostname}" resolves to a private/reserved address (${address}) — refusing to fetch it.`);
      }
    }
  }
}

/** Unlike packages/vault's own withTimeout (which races a promise it
 *  cannot cancel, leaving the original hung forever), this actually
 *  aborts the in-flight fetch via AbortController on timeout — the
 *  underlying connection gets torn down, not just ignored. A promise
 *  from a genuinely un-abortable source would still dangle either way;
 *  fetch() honors the signal, which is the only caller here. */
function withTimeout<T>(run: (signal: AbortSignal) => Promise<T>, ms: number): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new WebsiteFetchTimeoutError(`Fetching the site took longer than ${ms}ms.`)), ms);
  timer.unref?.();
  return run(controller.signal).finally(() => clearTimeout(timer));
}

/** Single bounded attempt, no retry loop — matches packages/vault's own
 *  withTimeout convention in spirit (vault.ts), not the untimed fetch()
 *  calls elsewhere in this codebase (apps/api/src/brainKeys/
 *  providerValidation.ts, oauth/googleCalendar.ts) — those are a real
 *  gap, not precedent to copy. Manually follows redirects (fetch's own
 *  `redirect: "follow"` would connect to each hop before this code ever
 *  saw the URL) so every hop gets the same scheme/private-IP check the
 *  original URL did. */
async function fetchFollowingRedirectsSafely(
  startUrl: URL,
  timeoutMs: number,
  fetchImpl: typeof fetch,
  dnsLookup: typeof dns.lookup,
): Promise<Response> {
  return withTimeout(async (signal) => {
      let current = startUrl;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        await assertSafeToFetch(current, dnsLookup);
        const res = await fetchImpl(current, {
          redirect: "manual",
          signal,
          headers: { "user-agent": "RunwiselyBot/1.0 (+https://www.runwisely.cc)" },
        });
        if (res.status >= 300 && res.status < 400) {
          const location = res.headers.get("location");
          if (!location) throw new WebsiteFetchFailedError(`Redirect (${res.status}) with no Location header.`);
          current = new URL(location, current);
          continue;
        }
        return res;
      }
      throw new WebsiteFetchFailedError(`Too many redirects (over ${MAX_REDIRECTS}).`);
    },
    timeoutMs,
  );
}

// Deliberately not a real HTML parser (no cheerio/jsdom) — stripping
// <script>/<style> blocks then all remaining tags is lossy but sufficient
// for "give the model enough visible text to summarize," and avoids both
// a new runtime dependency and jsdom's own JS-execution engine, which is
// the opposite of what a page from an untrusted URL should get to do.
// ponytail: regex-based extraction, upgrade to a real parser (cheerio) if
// this proves too lossy against real sites in practice.
function htmlToText(html: string): string {
  const withoutScriptsAndStyles = html.replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, " ");
  const withoutTags = withoutScriptsAndStyles.replace(/<[^>]+>/g, " ");
  const decoded = withoutTags
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
  return decoded.replace(/\s+/g, " ").trim();
}

export interface FetchWebsiteTextResult {
  text: string;
  finalUrl: string;
}

/**
 * Fetches a user-supplied URL and returns its visible text. Every failure
 * mode this can hit (unsafe URL, timeout, non-2xx, empty body) throws a
 * typed error the caller maps to "fall back to the plain-text idea box" —
 * never a dead end, per the product requirement. The returned text is
 * plain content to summarize, never instructions (T2) — that boundary is
 * enforced at the prompt-construction layer (websiteSummary.ts), not by
 * the type here: it's already a string because summarizing IS the point,
 * unlike packages/webhooks' `unknown`-typed payload, which nothing needs
 * to read as text.
 */
export async function fetchWebsiteText(
  rawUrl: string,
  opts: { timeoutMs: number; fetchImpl?: typeof fetch; dnsLookup?: typeof dns.lookup },
): Promise<FetchWebsiteTextResult> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeWebsiteUrlError(`"${rawUrl}" is not a valid URL.`);
  }

  const res = await fetchFollowingRedirectsSafely(url, opts.timeoutMs, opts.fetchImpl ?? fetch, opts.dnsLookup ?? dns.lookup);
  if (!res.ok) {
    throw new WebsiteFetchFailedError(`Site responded with HTTP ${res.status}.`);
  }
  const contentType = res.headers.get("content-type") ?? "";
  if (!contentType.includes("text/html") && !contentType.includes("text/plain") && contentType !== "") {
    throw new WebsiteFetchFailedError(`Site returned "${contentType}", not a readable page.`);
  }

  const reader = res.body?.getReader();
  if (!reader) throw new WebsiteFetchFailedError("Site returned no body.");
  let received = 0;
  const chunks: Uint8Array[] = [];
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    received += value.byteLength;
    if (received > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new WebsiteFetchFailedError(`Site response exceeded ${MAX_RESPONSE_BYTES} bytes.`);
    }
    chunks.push(value);
  }
  const html = Buffer.concat(chunks).toString("utf-8");
  const text = htmlToText(html);

  return { text, finalUrl: res.url };
}
