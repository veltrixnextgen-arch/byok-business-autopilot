import type { TeamHint } from "@byok/contracts";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { apiClient } from "../lib/apiClient";
import { getBrainKeyStatus, type BrainKeyStatus } from "../lib/brainKeyClient";
import { getOrgChartForTenant, type LatestBatch } from "../lib/extractionClient";
import { DOT_TONE_CLASSES, TEAM_HINT_TONE } from "../lib/teamHints";
import { AppShell } from "./AppShell";
import { SchedulePauseBanner } from "./SchedulePauseBanner";
import { Button, Card, cx } from "./ui";

interface Me {
  userId: string;
  email: string;
  tenantId: string;
}

interface SpendByDimension {
  key: string;
  totalUsd: number;
}

interface AuditEvent {
  id: string;
  source: "cost-gate" | "approval-queue";
  kind: string;
  refId?: string;
  at: string;
}

interface DashboardData {
  spendByRoleAllTime: SpendByDimension[];
  spendByRoleToday: SpendByDimension[];
  recentActivity: AuditEvent[];
}

// Real, human-readable labels for the audit log's known event kinds
// (apps/api/src/routes/dashboard.ts's doc comment lists the full set this
// mirrors) — presentation only, falls back to the raw kind string for
// anything unrecognized rather than inventing a description.
const ACTIVITY_KIND_LABELS: Record<string, string> = {
  reserved: "Cost reserved",
  settled: "Cost settled",
  queued: "Queued for approval",
  // Effect-dispatch decision (docs/DECISIONS.md): "Reviewed", not
  // "Approved" — draft-only for all of MVP-1/Phase 2, so the activity
  // feed must not read as if something was actually sent/executed.
  APPROVE: "Reviewed",
  REJECT: "Rejected",
  MODIFY: "Modified",
  "recommendation-submitted": "Recommendation submitted",
  "recommendation-resolved": "Recommendation resolved",
};

function labelForKind(kind: string): string {
  return ACTIVITY_KIND_LABELS[kind] ?? kind;
}

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const minutes = Math.round(ms / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

// Foundation dashboard (STEP 7 design fidelity pass, Phase 1C): the
// reference's layout — stat cards, cost-by-team, an activity feed, and a
// suggestions panel — but honest about what apps/api actually exposes
// today. Agents-active, work-completed-today, and approvals-waiting have
// no data source yet (no agent registry or approval-queue route exists) —
// they render as empty states, not invented numbers. Spend-today,
// cost-by-team, and the activity feed are real, read from the new
// GET /dashboard route (a pure pass-through over
// apps/router's already-tenant-scoped CostActivityQueries). Suggestions
// has no data source at all yet (no "skip-the-call" analysis exists) —
// always an empty state.
export function DashboardScreen() {
  const [me, setMe] = useState<Me | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [batch, setBatch] = useState<LatestBatch | null>(null);
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [dashboardError, setDashboardError] = useState<string | null>(null);
  // null = "not connected yet" (a real, known state); undefined = "still
  // checking" — distinct so the CTA below never flashes on for a user who
  // actually has a key, before the check resolves.
  const [brainKeyStatus, setBrainKeyStatus] = useState<BrainKeyStatus | null | undefined>(undefined);

  useEffect(() => {
    apiClient.me
      .$get()
      .then(async (res) => {
        if (!res.ok) {
          setError(`API returned ${res.status}`);
          return;
        }
        setMe(await res.json());
      })
      .catch((err: unknown) => setError(String(err)));

    apiClient.dashboard
      .$get()
      .then(async (res) => {
        if (!res.ok) {
          setDashboardError(`API returned ${res.status}`);
          return;
        }
        setDashboard(await res.json());
      })
      .catch((err: unknown) => setDashboardError(String(err)));

    // Fire-and-forget, same spirit as recordFunnelEvent — a returning
    // user's "back into your org chart" link (and the cost-by-team
    // panel's real team titles below) are nice-to-haves, not something
    // worth blocking or erroring the dashboard over. Tenant-scoped
    // (issue #38): dashboard.tsx's beforeLoad already guarantees an
    // active organization exists by the time this component renders, so
    // the org chart lives at the claimed, tenant-scoped read path, not
    // the pre-org getLatestBatch (which can no longer see a claimed row).
    getOrgChartForTenant()
      .then(setBatch)
      .catch(() => {});

    // Same fire-and-forget spirit — a failed check must never block or
    // error the dashboard. Falls back to "not connected" rather than
    // silently hiding the CTA: an occasional redundant nag on a
    // transient failure is a lot cheaper than masking a genuinely
    // disconnected tenant behind a swallowed error.
    getBrainKeyStatus()
      .then(setBrainKeyStatus)
      .catch(() => setBrainKeyStatus(null));
  }, []);

  const spendToday = dashboard?.spendByRoleToday.reduce((sum, r) => sum + r.totalUsd, 0) ?? null;
  const teamTitle = (key: string) => batch?.orgChart?.teams.find((t) => t.id === key)?.roleTitle ?? key;
  const maxSpend = Math.max(1, ...(dashboard?.spendByRoleAllTime.map((r) => r.totalUsd) ?? [0]));

  return (
    <AppShell active="/dashboard">
    <main className="mx-auto max-w-4xl px-6 py-16">
      <header className="mb-10 space-y-1">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">Dashboard</p>
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Dashboard</h1>
        {me && <p className="text-sm text-text-secondary">Signed in as {me.email}</p>}
      </header>

      {error && (
        <p role="alert" className="mb-8 rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
          {error}
        </p>
      )}

      {me ? (
        <div className="space-y-6">
          <SchedulePauseBanner />

          {brainKeyStatus === null && (
            <Card className="flex flex-col items-start justify-between gap-4 border-accent/30 bg-accent/5 sm:flex-row sm:items-center">
              <div>
                <p className="font-display text-base font-semibold text-text">Connect a Brain to get started</p>
                <p className="mt-1 text-sm text-text-secondary">
                  Your agents need an AI provider's API key — yours, not ours — before they can do any real work.
                </p>
              </div>
              <Link to="/connect" className="shrink-0">
                <Button variant="gradient">Connect a Brain</Button>
              </Link>
            </Card>
          )}

          {/* ADR-031: a key can be "connected" (its row exists, not
              revoked) while genuinely undecryptable — most likely a
              rotated KMS master key. Showing this exactly like "never
              connected" would hide a real, actionable problem; showing
              nothing at all is the "reports healthy, is broken" pattern
              this signal exists specifically to avoid. */}
          {brainKeyStatus != null && !brainKeyStatus.decryptable && (
            <Card className="flex flex-col items-start justify-between gap-4 border-danger/30 bg-danger/10 sm:flex-row sm:items-center">
              <div role="alert">
                <p className="font-display text-base font-semibold text-text">Your connected Brain key can't be used right now</p>
                <p className="mt-1 text-sm text-text-secondary">
                  It's connected, but we can no longer decrypt it — reconnect it to keep your agents working.
                </p>
              </div>
              <Link to="/connect" className="shrink-0">
                <Button variant="gradient">Reconnect</Button>
              </Link>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
            <StatTile label="Agents active" value={null} />
            <StatTile label="Work completed today" value={null} />
            <StatTile label="Spend today" value={spendToday !== null ? `$${spendToday.toFixed(2)}` : null} pending={!dashboard && !dashboardError} />
            <StatTile label="Approvals waiting" value={null} />
          </div>

          <div className="grid gap-6 lg:grid-cols-2">
            <Card>
              <h2 className="font-display text-base font-semibold text-text">Cost by team</h2>
              {dashboardError ? (
                <p className="mt-4 text-sm text-danger">{dashboardError}</p>
              ) : !dashboard ? (
                <p className="mt-4 text-sm text-text-muted">Loading…</p>
              ) : dashboard.spendByRoleAllTime.length === 0 ? (
                <p className="mt-4 text-sm text-text-muted">No spend yet — nothing to show until your agents start working.</p>
              ) : (
                <ul className="mt-4 space-y-3">
                  {dashboard.spendByRoleAllTime.map((row) => {
                    const tone = TEAM_HINT_TONE[row.key as TeamHint] ?? "accent";
                    return (
                      <li key={row.key}>
                        <div className="mb-1 flex items-center justify-between gap-3 text-sm">
                          <span className="flex items-center gap-2 text-text">
                            <span className={cx("size-1.5 shrink-0 rounded-full", DOT_TONE_CLASSES[tone])} aria-hidden="true" />
                            {teamTitle(row.key)}
                          </span>
                          <span className="font-mono text-xs text-text-muted">${row.totalUsd.toFixed(2)}</span>
                        </div>
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-white/10">
                          <div className={cx("h-full rounded-full", DOT_TONE_CLASSES[tone])} style={{ width: `${Math.max(4, (row.totalUsd / maxSpend) * 100)}%` }} />
                        </div>
                      </li>
                    );
                  })}
                </ul>
              )}
            </Card>

            <Card>
              <h2 className="font-display text-base font-semibold text-text">Recent activity</h2>
              {dashboardError ? (
                <p className="mt-4 text-sm text-danger">{dashboardError}</p>
              ) : !dashboard ? (
                <p className="mt-4 text-sm text-text-muted">Loading…</p>
              ) : dashboard.recentActivity.length === 0 ? (
                <p className="mt-4 text-sm text-text-muted">No activity yet.</p>
              ) : (
                <ul className="mt-4 divide-y divide-border-subtle">
                  {dashboard.recentActivity.map((event) => (
                    <li key={event.id} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <div className="min-w-0">
                        <p className="truncate text-sm text-text">{labelForKind(event.kind)}</p>
                        <p className="font-mono text-[10px] uppercase tracking-[0.1em] text-text-muted">{event.source}</p>
                      </div>
                      <span className="shrink-0 font-mono text-xs text-text-muted">{relativeTime(event.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>

          <Card>
            <h2 className="font-display text-base font-semibold text-text">Suggestions</h2>
            <p className="mt-4 text-sm text-text-muted">Cost-saving suggestions aren't available yet.</p>
          </Card>

          {batch?.status === "completed" && (
            <Link
              to="/org-chart"
              className="inline-block text-center font-medium text-accent transition-colors duration-calm-fast ease-calm hover:text-accent-strong"
            >
              View your org chart →
            </Link>
          )}
        </div>
      ) : (
        !error && <p className="text-text-muted">Loading…</p>
      )}
    </main>
    </AppShell>
  );
}

function StatTile({ label, value, pending }: { label: string; value: string | null; pending?: boolean }) {
  return (
    <Card className="p-4">
      <p className="font-mono text-[9px] uppercase tracking-[0.15em] text-text-muted">{label}</p>
      {value !== null ? (
        <p className="mt-1.5 font-display text-2xl font-semibold text-text">{value}</p>
      ) : (
        <p className="mt-1.5 font-display text-2xl font-semibold text-text-muted">{pending ? "…" : "—"}</p>
      )}
      {value === null && !pending && <p className="mt-0.5 text-[11px] text-text-muted">Not tracked yet</p>}
    </Card>
  );
}
