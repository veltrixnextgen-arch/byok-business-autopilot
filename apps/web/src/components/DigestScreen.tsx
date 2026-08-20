import { useEffect, useState } from "react";
import { getDigest, type Digest } from "../lib/digestClient";
import { AppShell } from "./AppShell";
import { Card } from "./ui";

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; digest: Digest | null };

function formatDate(iso: string): string {
  // Parsed as UTC-midnight (buildDigestData.ts's own `date` field), then
  // displayed as a plain calendar date — no timezone-shifted "yesterday"
  // surprise from new Date("2026-08-20") being interpreted locally.
  const [year, month, day] = iso.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
}

// R4: real data only, same discipline as DashboardScreen — every number
// here is a read from buildDigestData.ts (cost_reservations,
// approval_queue_items, the org chart), the same aggregation the daily
// email uses. No "In progress" or "Agent notes" panel: neither has a
// real backing data source yet, and an always-empty panel would be
// worse than no panel at all.
export function DigestScreen() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    getDigest()
      .then((digest) => setState({ kind: "ready", digest }))
      .catch((err: unknown) => setState({ kind: "error", message: String(err) }));
  }, []);

  return (
    <AppShell active="/digest">
      <div className="mx-auto max-w-4xl px-6 py-16">
        <header className="mb-10 space-y-1">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">Digest</p>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {state.kind === "ready" && state.digest ? formatDate(state.digest.date) : "Digest"}
          </h1>
        </header>

        {state.kind === "loading" && <p className="text-text-muted">Loading…</p>}
        {state.kind === "error" && (
          <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
            {state.message}
          </p>
        )}

        {state.kind === "ready" && !state.digest && (
          <Card className="text-center">
            <p className="font-display text-base font-semibold text-text">Nothing to report yet</p>
            <p className="mt-2 text-sm text-text-secondary">
              Your digest fills in once your company's Charter is active and its org chart exists.
            </p>
          </Card>
        )}

        {state.kind === "ready" && state.digest && (
          <div className="space-y-6">
            <Card>
              <h2 className="font-display text-base font-semibold text-text">What your agents did</h2>
              {state.digest.agentActivity.length === 0 ? (
                <p className="mt-4 text-sm text-text-muted">No agent activity today.</p>
              ) : (
                <ul className="mt-4 divide-y divide-border-subtle">
                  {state.digest.agentActivity.map((agent) => (
                    <li key={agent.agentId} className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                      <span className="text-sm text-text">{agent.agentName}</span>
                      <span className="font-mono text-xs text-text-muted">
                        {agent.taskCount} task{agent.taskCount === 1 ? "" : "s"} · ${agent.spentUsd.toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>

            <Card>
              <h2 className="font-display text-base font-semibold text-text">Waiting on you</h2>
              <p className="mt-4 text-sm text-text-secondary">
                {state.digest.pendingApprovalCount === 0
                  ? "Nothing waiting on your approval."
                  : `${state.digest.pendingApprovalCount} item${state.digest.pendingApprovalCount === 1 ? "" : "s"} waiting on your approval.`}
              </p>
            </Card>

            <Card>
              <h2 className="font-display text-base font-semibold text-text">Spend</h2>
              <p className="mt-4 text-sm text-text-secondary">
                ${state.digest.spentUsd.toFixed(2)} of your ${state.digest.ceilingUsd.toFixed(2)} monthly ceiling.
              </p>
            </Card>
          </div>
        )}
      </div>
    </AppShell>
  );
}
