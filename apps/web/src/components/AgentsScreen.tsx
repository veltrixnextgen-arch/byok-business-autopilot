import { useEffect, useState } from "react";
import { TIER_DEFAULT_BUDGET_PER_DAY_USD } from "@byok/contracts";
import { getAgentBudgets, setAgentBudget, InvalidAgentBudgetError, type AgentBudgetInfo } from "../lib/agentBudgetClient";
import { getOrgChartForTenant, type LatestBatch } from "../lib/extractionClient";
import { DOT_TONE_CLASSES, RISK_TIER_LABEL, RISK_TIER_TONE, TEAM_HINT_TONE } from "../lib/teamHints";
import { AppShell } from "./AppShell";
import { SchedulePauseBanner } from "./SchedulePauseBanner";
import { Badge, Card, cx } from "./ui";

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; batch: LatestBatch | null };

/** North star doc Tier 1 item 3: budgets are fetched separately from the
 *  org chart (getAgentBudgets, not batch.orgChart.agents[].budget) because
 *  this is the one place an agent's override — not just its tier-default —
 *  needs to show. Best-effort: a failure here still leaves the rest of
 *  the screen usable, just showing each agent's own tier-default instead. */
function useAgentBudgets() {
  const [budgets, setBudgets] = useState<Map<string, AgentBudgetInfo>>(new Map());

  useEffect(() => {
    getAgentBudgets()
      .then((agents) => setBudgets(new Map(agents.map((a) => [a.agentId, a]))))
      .catch(() => {
        // Best-effort — AgentCard falls back to the org chart's own
        // tier-default budget.perDayUsd when no entry exists here.
      });
  }, []);

  return [budgets, setBudgets] as const;
}

// Real data, no dedicated backend endpoint needed: every agent already
// lives on the tenant's claimed org chart (getOrgChartForTenant, the
// same read DashboardScreen and OrgChartScreen use). This is a flat
// list view over that same data, not a new feature — per-agent detail
// (docs/design/emergent-app-screens/agent-detail.md) is the actual
// unbuilt feature and isn't reproduced here.
export function AgentsScreen() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [budgets, setBudgets] = useAgentBudgets();
  const [editingId, setEditingId] = useState<string | null>(null);

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

        <SchedulePauseBanner />

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
              const budgetInfo = budgets.get(agent.id);
              // agent.budget can be missing on a stored org chart older
              // than the field itself (see ceiling.ts's own comment) — the
              // /me/agent-budgets fetch above already carries the right
              // tier-default fallback, so this local one only matters
              // before that request resolves.
              const perDayUsd = budgetInfo?.perDayUsd ?? agent.budget?.perDayUsd ?? TIER_DEFAULT_BUDGET_PER_DAY_USD[agent.tier];
              const isOverride = budgetInfo?.source === "override";
              const riskTier = agent.riskTier ?? "low";
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
                    <div className="flex shrink-0 flex-col items-end gap-1.5">
                      <Badge tone={tone}>{agent.tier}</Badge>
                      <Badge tone={RISK_TIER_TONE[riskTier]}>{RISK_TIER_LABEL[riskTier]}</Badge>
                    </div>
                  </div>
                  <p className="mt-3 text-sm text-text-secondary">{agent.objective}</p>
                  {agent.brain && (
                    <p className="mt-2 text-xs text-text-muted" title={agent.brain.reason}>
                      <span className="font-mono uppercase tracking-[0.15em]">Brain: {agent.brain.provider}</span> — {agent.brain.reason}
                    </p>
                  )}
                  <div className="mt-3 flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted">
                    <span>Reports into {agent.reportingStructure.teamRoleTitle}</span>
                    {editingId === agent.id ? (
                      <BudgetEditor
                        initialUsd={perDayUsd}
                        onCancel={() => setEditingId(null)}
                        onSave={async (value) => {
                          await setAgentBudget(agent.id, value);
                          setBudgets((prev) => new Map(prev).set(agent.id, { agentId: agent.id, name: agent.name, title: agent.title, perDayUsd: value, source: "override" }));
                          setEditingId(null);
                        }}
                      />
                    ) : (
                      <button type="button" onClick={() => setEditingId(agent.id)} className="underline underline-offset-2 hover:text-text-secondary">
                        Up to ${perDayUsd}/day{isOverride ? " (set by you)" : ""}
                      </button>
                    )}
                  </div>
                  {agent.hands.length > 0 && (
                    <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted">
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

/** Inline, not a modal — matches this screen's own "flat list, no
 *  drill-in" philosophy (this file's own header comment) rather than
 *  introducing a new interaction pattern for one field. */
function BudgetEditor({
  initialUsd,
  onSave,
  onCancel,
}: {
  initialUsd: number;
  onSave: (value: number) => Promise<void>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState(String(initialUsd));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function save() {
    const value = Number(draft);
    if (!Number.isFinite(value) || value <= 0) {
      setError("Enter a number greater than 0.");
      return;
    }
    setSaving(true);
    try {
      await onSave(value);
    } catch (err) {
      setError(err instanceof InvalidAgentBudgetError ? err.message : "Couldn't save that — try again.");
      setSaving(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5 normal-case tracking-normal">
      $
      <input
        autoFocus
        type="number"
        min="0.01"
        step="0.01"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void save();
          if (e.key === "Escape") onCancel();
        }}
        className="w-16 rounded border border-accent bg-bg-glass px-1.5 py-0.5 text-text focus:outline-none"
      />
      /day
      <button type="button" onClick={() => void save()} disabled={saving} className="text-accent hover:underline">
        Save
      </button>
      <button type="button" onClick={onCancel} className="hover:underline">
        Cancel
      </button>
      {error && (
        <span role="alert" className="text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
