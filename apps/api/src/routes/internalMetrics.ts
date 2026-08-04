import type { PoolLike, SignupExtractionBatchStore, SignupMetricsStore } from "@byok/db";
import { Hono } from "hono";

const SCREEN_ORDER = ["signup", "interview", "tasks", "org_chart"] as const;

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export interface InternalMetricsDeps {
  pool: PoolLike;
  metricsStore: Pick<SignupMetricsStore, "allFunnelEvents" | "allFeedback">;
  batchStore: Pick<SignupExtractionBatchStore, "allLatestBatchSummaries">;
  /** ADR-003-style platform credential, not a user credential — required
   *  at startup same as ANTHROPIC_API_KEY (see server.ts), so a server
   *  that can't gate this route doesn't silently serve it unprotected. */
  token: string;
}

/**
 * MVP-0 tester gate (Phase B Step 6C): the founder's one page for "how did
 * the twenty testers do" — completion per screen, drop-off point,
 * extraction cost, time to org chart, and the one feedback question.
 * Token-gated (X-Internal-Metrics-Token header, constant-time compared),
 * not behind userMiddleware — this isn't a tenant or user view, it's an
 * operator view across every signup. Deliberately a server-rendered HTML
 * table, not a client app route: "no dashboard polish" per the spec that
 * asked for this.
 */
export function internalMetricsRoute(deps: InternalMetricsDeps) {
  return new Hono().get("/", async (c) => {
    const provided = c.req.header("x-internal-metrics-token") ?? "";
    if (!timingSafeEqual(provided, deps.token)) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const client = await deps.pool.connect();
    let users: { id: string; email: string; created_at: string }[];
    try {
      const result = (await client.query("SELECT id, email, created_at FROM users ORDER BY created_at ASC")) as unknown as {
        rows: { id: string; email: string; created_at: string }[];
      };
      users = result.rows;
    } finally {
      client.release();
    }

    const [events, feedback, batches] = await Promise.all([
      deps.metricsStore.allFunnelEvents(),
      deps.metricsStore.allFeedback(),
      deps.batchStore.allLatestBatchSummaries(),
    ]);

    const eventsByUser = new Map<string, Map<string, string>>();
    for (const e of events) {
      if (!eventsByUser.has(e.userId)) eventsByUser.set(e.userId, new Map());
      eventsByUser.get(e.userId)!.set(e.screen, e.at);
    }
    const feedbackByUser = new Map(feedback.map((f) => [f.userId, f]));
    const batchByUser = new Map(batches.map((b) => [b.userId, b]));

    const rows = users.map((u) => {
      const screens = eventsByUser.get(u.id) ?? new Map<string, string>();
      const reached = SCREEN_ORDER.filter((s) => screens.has(s));
      const dropOff = reached.length === 0 ? "idea_input" : reached[reached.length - 1];
      const signupAt = screens.get("signup");
      const orgChartAt = screens.get("org_chart");
      const timeToOrgChartSeconds =
        signupAt && orgChartAt ? Math.round((new Date(orgChartAt).getTime() - new Date(signupAt).getTime()) / 1000) : null;
      const batch = batchByUser.get(u.id);
      const fb = feedbackByUser.get(u.id);
      return { user: u, reached, dropOff, timeToOrgChartSeconds, batch, feedback: fb };
    });

    const completionRates = SCREEN_ORDER.map((screen) => {
      const count = rows.filter((r) => r.reached.includes(screen)).length;
      const pct = users.length === 0 ? 0 : Math.round((count / users.length) * 100);
      return `${screen}: ${count}/${users.length} (${pct}%)`;
    }).join(" · ");

    const tableRows = rows
      .map((r) => {
        const screensCell = SCREEN_ORDER.map((s) => (r.reached.includes(s) ? "✓" : "—")).join(" ");
        const cost = r.batch?.costUsd != null ? `$${r.batch.costUsd.toFixed(4)}` : "—";
        const timeToOrgChart = r.timeToOrgChartSeconds != null ? `${r.timeToOrgChartSeconds}s` : "—";
        const feedbackCell = r.feedback
          ? `${r.feedback.taughtSomething ? "Yes" : "No"}${r.feedback.freeText ? `: ${escapeHtml(r.feedback.freeText)}` : ""}`
          : "—";
        return `<tr>
          <td>${escapeHtml(r.user.email)}</td>
          <td>${escapeHtml(new Date(r.user.created_at).toISOString())}</td>
          <td>${screensCell}</td>
          <td>${escapeHtml(r.dropOff)}</td>
          <td>${cost}</td>
          <td>${timeToOrgChart}</td>
          <td>${feedbackCell}</td>
        </tr>`;
      })
      .join("\n");

    const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Signup metrics</title>
<style>
  body { font-family: monospace; padding: 2rem; background: #111; color: #eee; }
  table { border-collapse: collapse; width: 100%; }
  td, th { border: 1px solid #444; padding: 0.4rem 0.6rem; text-align: left; font-size: 0.85rem; }
  th { background: #222; }
  h1 { font-size: 1.1rem; }
  .summary { margin-bottom: 1rem; color: #9cf; }
</style></head>
<body>
<h1>Signup metrics — ${users.length} signup(s)</h1>
<p class="summary">${escapeHtml(completionRates)}</p>
<table>
  <tr><th>Email</th><th>Signed up</th><th>signup interview tasks org_chart</th><th>Drop-off</th><th>Cost</th><th>Time to org chart</th><th>"Taught you something?"</th></tr>
  ${tableRows}
</table>
</body></html>`;

    return c.html(html);
  });
}

/** Avoids a short-circuit-on-first-mismatch timing side channel for a
 *  bearer-token comparison — same reasoning as any secret-comparison
 *  code, scaled to a route with real (if low-stakes) exposure. */
function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}
