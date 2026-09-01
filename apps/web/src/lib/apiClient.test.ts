import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { CROSS_ORIGIN_AUTH_TOKEN_KEY } from "@byok/auth/client";
import { fetchWithBearerFallback } from "./apiClient";

// Root-causes the "session expired" false negative on directApiClient's
// cross-origin calls (packages/auth/src/config.ts's own `bearer()` plugin
// comment has the full story: SameSite=None makes the cookie eligible to
// be sent cross-site, but a browser's separate third-party-cookie policy
// can still block it regardless — an explicit Authorization header isn't
// a cookie, so no such policy applies to it).
describe("fetchWithBearerFallback", () => {
  const originalFetch = global.fetch;

  beforeEach(() => {
    global.fetch = vi.fn().mockResolvedValue(new Response(null));
  });

  afterEach(() => {
    global.fetch = originalFetch;
    sessionStorage.clear();
  });

  it("attaches Authorization: Bearer <token> when a token was captured at sign-in", async () => {
    sessionStorage.setItem(CROSS_ORIGIN_AUTH_TOKEN_KEY, "the-real-session-token");

    await fetchWithBearerFallback("https://byokapi.example/api/extraction/questions", { method: "POST" });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer the-real-session-token");
  });

  it("makes a plain, unmodified call when no token has been captured yet", async () => {
    await fetchWithBearerFallback("https://byokapi.example/api/extraction/questions", { method: "POST" });

    const [url, init] = vi.mocked(fetch).mock.calls[0]!;
    expect(url).toBe("https://byokapi.example/api/extraction/questions");
    expect(init?.headers).toBeUndefined();
  });

  it("preserves the caller's own headers alongside the Authorization header", async () => {
    sessionStorage.setItem(CROSS_ORIGIN_AUTH_TOKEN_KEY, "tok");

    await fetchWithBearerFallback("https://byokapi.example/api/x", {
      headers: { "content-type": "application/json" },
    });

    const [, init] = vi.mocked(fetch).mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("Authorization")).toBe("Bearer tok");
  });
});
