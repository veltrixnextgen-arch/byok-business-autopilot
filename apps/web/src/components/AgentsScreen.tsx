import { useEffect, useState } from "react";
import { getOrgChartForTenant, type LatestBatch } from "../lib/extractionClient";
import { DOT_TONE_CLASSES, TEAM_HINT_TONE } from "../lib/teamHints";
import { AppShell } from "./AppShell";
import { Badge, Card, cx } from "./ui";

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; batch: LatestBatch | null };

// Real data, no dedicated backend endpoint needed: every agent already
// lives on the tenant's claimed org chart (getOrgChartForTenant, the
// same read DashboardScreen and OrgChartScreen use). This is a flat
// list view over that same data, not a new feature — per-agent detail
// (docs/design/emergent-app-screens/agent-detail.md) is the actual
// unbuilt feature and isn't reproduced here.
export function AgentsScreen() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    getOrgChartForTenant()
      .then((batch) => setState({ kind: "ready", batch }))
      .catch((err: unknown) => setState({ kind: "error", message: String(err) }));
  }, []);

  return (
    <AppShell active="/agents">
      <div className="mx-auto max-w-4xl px-6 py-16">
        <header className="mb-10 space-y-1">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">Agents</p>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Agents</h1>
        </header>

        {state.kind === "loading" && <p className="text-text-muted">Loading…</p>}
        {state.kind === "error" && (
          <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
            {state.message}
          </p>
        )}
        {state.kind === "ready" && (!state.batch?.orgChart || state.batch.orgChart.agents.length === 0) && (
          <Card className="text-center">
            <p className="font-display text-base font-semibold text-text">No agents yet</p>
            <p className="mt-2 text-sm text-text-secondary">
              Agents appear here once your company's org chart finishes assembling.
            </p>
          </Card>
        )}
        {state.kind === "ready" && state.batch?.orgChart && state.batch.orgChart.agents.length > 0 && (
          <div className="grid gap-4 sm:grid-cols-2">
            {state.batch.orgChart.agents.map((agent) => {
              const tone = TEAM_HINT_TONE[agent.teamId] ?? "accent";
              return (
                <Card key={agent.id}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 truncate font-display text-base font-semibold text-text">
                        <span className={cx("size-1.5 shrink-0 rounded-full", DOT_TONE_CLASSES[tone])} aria-hidden="true" />
                        {agent.name}
                      </p>
                      <p className="mt-0.5 truncate text-sm text-text-secondary">{agent.title}</p>
                    </div>
                    <Badge tone={tone}>{agent.tier}</Badge>
                  </div>
                  {agent.hands.length > 0 && (
                    <p className="mt-4 font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted">
                      Tools: {agent.hands.join(", ")}
                    </p>
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </AppShell>
  );
}
