import type { Agent, OrgChart, Task } from "@byok/contracts";
import { authMethodForTool, oauthServiceForTool } from "@byok/templates";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getLatestBatch, getOrgChartForTenant, reassemble, recordFunnelEvent, renameAgent, submitFeedback } from "../lib/extractionClient";
import { connectHandsKey, getHandsKeyStatus, handsOAuthStartUrl, type HandsKeyStatus } from "../lib/handsKeyClient";
import { AVATAR_RING_CLASSES, DOT_TONE_CLASSES, RISK_TIER_LABEL, RISK_TIER_TONE, TEAM_HINT_TONE } from "../lib/teamHints";
import { AppShell } from "./AppShell";
import { Badge, type BadgeTone, Button, Card, FormError, TextInput } from "./ui";

type LoadState = { kind: "loading" } | { kind: "waiting" } | { kind: "error"; message: string } | { kind: "ready"; batchId: string; chart: OrgChart };

// Split out of routes/org-chart.tsx (a plain export here, so it's directly
// testable) — see components/InterviewScreen.tsx's own comment for why:
// TanStack Start's route-file compiler only lazy-splits a route's local
// `component`, and stops the moment that symbol is also exported for
// anything else.
export function OrgChartScreen() {
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    async function load() {
      try {
        // Primary path: the fresh, pre-org reveal right after extraction
        // completes (unchanged). If nothing's there, this may be a
        // revisit after the org-chart -> tenant handoff already claimed
        // it (issue #38) — getLatestBatch can no longer see a claimed
        // row once tenant_id is set, so fall back to the tenant-scoped
        // read. That fallback 401s (swallowed here) for a user with no
        // active organization at all, which is the same "nothing to
        // show" case as today.
        let batch = await getLatestBatch();
        if (!batch) {
          batch = await Promise.resolve(getOrgChartForTenant()).catch(() => null);
        }
        if (cancelled) return;
        if (!batch) {
          await navigate({ to: "/" });
          return;
        }
        if (batch.status === "running") {
          setState({ kind: "waiting" });
          timer = setTimeout(load, 2000);
          return;
        }
        if (batch.status !== "completed" || !batch.orgChart) {
          setState({ kind: "error", message: batch.error ?? "Extraction didn't complete." });
          return;
        }
        recordFunnelEvent("org_chart");
        setState({ kind: "ready", batchId: batch.id, chart: batch.orgChart });
      } catch (err) {
        if (!cancelled) setState({ kind: "error", message: err instanceof Error ? err.message : "Could not load your org chart." });
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (timer) clearTimeout(timer);
    };
  }, [navigate]);

  if (state.kind === "loading" || state.kind === "waiting") {
    return (
      <AppShell active="/org-chart">
        <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center">
          <p className="text-text-secondary duration-calm-base ease-calm">
            {state.kind === "waiting" ? "Still building your company…" : "Loading…"}
          </p>
        </main>
      </AppShell>
    );
  }

  if (state.kind === "error") {
    return (
      <AppShell active="/org-chart">
        <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
          <p role="alert" className="text-danger">
            {state.message}
          </p>
          <Button onClick={() => navigate({ to: "/" })}>Start over</Button>
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell active="/org-chart">
      <OrgChartReveal batchId={state.batchId} initialChart={state.chart} />
    </AppShell>
  );
}

// Bottom-up staged assembly (userflow-v2.md: tasks -> agent cards -> teams
// -> role leads), CSS-transition-driven (no animation library — Phase B
// build rules), respecting prefers-reduced-motion by skipping straight to
// the final stage rather than just zeroing the CSS transition durations
// and leaving the user waiting through timers for no visible reason.
// Structured as one small stage-timing hook feeding pure stage-indexed
// className lookups, kept separate from the chart's actual layout JSX —
// swapping this for a richer animation later means changing
// STAGE_DURATIONS_MS and the per-stage classNames below, not the data flow
// (fetch -> chart state -> edit ops) around it.
const STAGE_DURATIONS_MS = [650, 750]; // tasks-rain -> agents-condense -> settled

function useRevealStage(): number {
  const [stage, setStage] = useState(0);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) {
      setStage(STAGE_DURATIONS_MS.length);
      return;
    }
    const timers = STAGE_DURATIONS_MS.map((_, i) =>
      setTimeout(() => setStage(i + 1), STAGE_DURATIONS_MS.slice(0, i + 1).reduce((a, b) => a + b, 0)),
    );
    return () => timers.forEach(clearTimeout);
  }, []);

  return stage;
}

type EditMode = { kind: "none" } | { kind: "merge"; selected: Set<string> } | { kind: "split"; agentId: string; selected: Set<string>; label: string };

// Shown briefly after a failed save (rename/merge/split) — the edit is
// simply not applied, the chart underneath stays exactly as it was, so
// "try again" is always literally true, not just reassuring copy.
const SAVE_ERROR_MESSAGE = "Couldn't save that — try again.";

function OrgChartReveal({ batchId, initialChart }: { batchId: string; initialChart: OrgChart }) {
  const stage = useRevealStage();
  const [chart, setChart] = useState(initialChart);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [editMode, setEditMode] = useState<EditMode>({ kind: "none" });
  const [busy, setBusy] = useState(false);
  const [shareStatus, setShareStatus] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  // Keyed `${agentId}::${tool}`. Undefined = not checked yet (renders as a
  // plain, non-interactive badge — issue #22 shouldn't make a badge look
  // clickable before we actually know its state); null = checked, not
  // connected; a status = connected. Refetches on every chart edit, not
  // just hands-relevant ones (merge/split can change agent ids) — simplest
  // correct behavior for how rarely a chart is actually edited.
  const [handsStatus, setHandsStatus] = useState<Map<string, HandsKeyStatus | null>>(new Map());
  // apps/api's /hands-oauth/:service/callback (PR 2B) redirects back here
  // with ?handsOAuth=connected|error&reason=... — a full page navigation
  // (the OAuth flow left and returned), so this is read from the URL once
  // on mount, not passed as component state. Cleared from the URL right
  // after so a refresh doesn't keep re-showing it.
  const [oauthBanner, setOauthBanner] = useState<{ status: "connected" | "error"; reason: string | null } | null>(null);

  const nonHumanTeams = chart.teams.filter((t) => !t.isHuman);
  const agentsById = new Map(chart.agents.map((a) => [a.id, a]));

  useEffect(() => {
    let cancelled = false;
    const pairs = chart.agents.flatMap((agent) => agent.hands.map((tool) => ({ agentId: agent.id, tool })));
    Promise.all(
      pairs.map(async ({ agentId, tool }) => [`${agentId}::${tool}`, await getHandsKeyStatus(agentId, tool).catch(() => null)] as const),
    ).then((entries) => {
      if (!cancelled) setHandsStatus(new Map(entries));
    });
    return () => {
      cancelled = true;
    };
  }, [chart]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get("handsOAuth");
    if (status !== "connected" && status !== "error") return;
    setOauthBanner({ status, reason: params.get("reason") });
    params.delete("handsOAuth");
    params.delete("reason");
    const rest = params.toString();
    window.history.replaceState({}, "", `${window.location.pathname}${rest ? `?${rest}` : ""}`);
  }, []);

  async function handleRename(agentId: string, name: string) {
    setRenamingId(null);
    if (!name.trim()) return;
    setBusy(true);
    setSaveError(null);
    try {
      setChart(await renameAgent(batchId, agentId, name.trim()));
    } catch {
      setSaveError(SAVE_ERROR_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  async function handleMerge() {
    if (editMode.kind !== "merge" || editMode.selected.size < 2) return;
    const [firstId, ...restIds] = [...editMode.selected];
    const first = agentsById.get(firstId);
    if (!first) return;
    const mergedTaskIds = new Set([...editMode.selected].flatMap((id) => agentsById.get(id)?.taskIds ?? []));
    const tasks: Task[] = chart.tasks.map((t) =>
      mergedTaskIds.has(t.id) ? { ...t, agentType: first.id, agentLabel: first.title } : t,
    );
    setBusy(true);
    setSaveError(null);
    try {
      setChart(await reassemble(batchId, tasks));
      setEditMode({ kind: "none" });
    } catch {
      setSaveError(SAVE_ERROR_MESSAGE);
    } finally {
      setBusy(false);
    }
    void restIds; // merged tasks all point at `first`'s agentType — re-clustering drops the rest naturally
  }

  async function handleSplit() {
    if (editMode.kind !== "split" || editMode.selected.size === 0 || !editMode.label.trim()) return;
    const newAgentType = `${editMode.agentId}-split-${Date.now()}`;
    const tasks: Task[] = chart.tasks.map((t) =>
      editMode.selected.has(t.id) ? { ...t, agentType: newAgentType, agentLabel: editMode.label.trim() } : t,
    );
    setBusy(true);
    setSaveError(null);
    try {
      setChart(await reassemble(batchId, tasks));
      setEditMode({ kind: "none" });
    } catch {
      setSaveError(SAVE_ERROR_MESSAGE);
    } finally {
      setBusy(false);
    }
  }

  async function handleShare() {
    const headline = `I just met my company: ${nonHumanTeams.length} roles running ${chart.tasks.length} tasks — "${chart.meta.idea}"`;
    // No public, unauthenticated share page exists yet — this shares the
    // page's own URL, which only resolves for the signed-in owner today.
    // Real growth-asset sharing (userflow-v2.md) needs a public view this
    // step didn't build; noted honestly rather than faked.
    if (navigator.share) {
      try {
        await navigator.share({ title: "My company", text: headline, url: window.location.href });
        return;
      } catch {
        // user cancelled — fall through to clipboard as a no-op-safe fallback
      }
    }
    await navigator.clipboard.writeText(`${headline}\n${window.location.href}`);
    setShareStatus("Copied!");
    setTimeout(() => setShareStatus(null), 2000);
  }

  return (
    <main className="mx-auto max-w-4xl px-6 py-16">
      <div className="mb-10 space-y-2 text-center duration-ceremony-slow ease-ceremony">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">Your Company Blueprint</p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          Meet the team behind your business.
        </h1>
        <p className="text-text-secondary">
          {chart.agents.length} agents · {nonHumanTeams.length} teams · {chart.tasks.length} tasks covered
        </p>
        {/* North star doc Tier 1 item 2: framing only, over the same org
            chart/Charter data already assembled below — this is not a new
            data source, just naming this page what it actually is: the
            blueprint for how the company runs (who does what, at what
            risk, on what budget), not just a static "meet the team" list. */}
        <p className="mx-auto max-w-lg text-xs text-text-muted">
          The full plan for how your company runs — roles, risk, and budget, in one place.
        </p>
      </div>

      {oauthBanner && (
        <Card className={`mb-6 ${oauthBanner.status === "error" ? "border-danger/30" : "border-money/30"}`}>
          <p className={`text-sm ${oauthBanner.status === "error" ? "text-danger" : "text-text"}`} role={oauthBanner.status === "error" ? "alert" : undefined}>
            {oauthBanner.status === "connected"
              ? "Connected — this agent can now act through it."
              : `Couldn't connect that — try again. (${oauthBanner.reason ?? "unknown error"})`}
          </p>
          <button
            type="button"
            onClick={() => setOauthBanner(null)}
            className="mt-1 text-xs text-text-muted underline underline-offset-4 hover:text-text-secondary"
          >
            Dismiss
          </button>
        </Card>
      )}

      {stage >= 1 && (
        <div className="mb-8 flex flex-col items-center gap-0 duration-ceremony-base ease-ceremony">
          <span className="rounded-lg bg-gradient-to-br from-accent-strong to-cta-warm px-5 py-2.5 font-display text-sm font-semibold text-white shadow-glow-cta">
            You · Founder
          </span>
          <span className="h-10 w-px bg-gradient-to-b from-accent/50 to-transparent" aria-hidden="true" />
        </div>
      )}

      {stage === 0 && (
        <div className="flex flex-wrap gap-2">
          {chart.tasks.slice(0, 24).map((task, i) => (
            <span
              key={task.id}
              className="animate-[fade-in_var(--duration-ceremony-fast)_var(--ease-ceremony)_both] rounded-full border border-border-subtle bg-bg-glass-subtle px-3 py-1 text-xs text-text-muted"
              style={{ animationDelay: `${Math.min(i * 25, 500)}ms` }}
            >
              {task.text}
            </span>
          ))}
        </div>
      )}

      {stage >= 1 && (
        <div className="grid gap-6 sm:grid-cols-2">
          {chart.teams.map((team, teamIndex) => (
            <div
              key={team.id}
              className="animate-[rise-in_var(--duration-ceremony-base)_var(--ease-ceremony)_both] space-y-3"
              style={{ animationDelay: `${teamIndex * 90}ms` }}
            >
              <h2 className="flex items-center gap-2 font-display text-sm font-semibold uppercase tracking-wide text-text-secondary">
                <span className={`size-2 shrink-0 rounded-full ${DOT_TONE_CLASSES[TEAM_HINT_TONE[team.id]]}`} aria-hidden="true" />
                {team.roleTitle}
                {team.isHuman && <span className="text-text-muted">(you)</span>}
                {!team.isHuman && <span className="font-mono text-xs font-normal normal-case tracking-normal text-text-muted">· {team.agentIds.length} agents</span>}
              </h2>
              <div className="space-y-3">
                {team.agentIds.map((agentId) => {
                  const agent = agentsById.get(agentId);
                  if (!agent) return null;
                  return (
                    <AgentCard
                      key={agentId}
                      agent={agent}
                      tone={TEAM_HINT_TONE[team.id]}
                      editable={stage >= 2}
                      renaming={renamingId === agentId}
                      onStartRename={() => setRenamingId(agentId)}
                      onRename={(name) => handleRename(agentId, name)}
                      selectableMode={editMode}
                      onToggleMergeSelect={() =>
                        setEditMode((m) =>
                          m.kind === "merge"
                            ? { kind: "merge", selected: toggled(m.selected, agentId) }
                            : { kind: "merge", selected: new Set([agentId]) },
                        )
                      }
                      onStartSplit={() => setEditMode({ kind: "split", agentId, selected: new Set(), label: "" })}
                      handsStatus={handsStatus}
                      onHandsConnected={(tool, status) =>
                        setHandsStatus((prev) => new Map(prev).set(`${agentId}::${tool}`, status))
                      }
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {saveError && (
        <p role="alert" className="mt-6 text-sm text-danger">
          {saveError}
        </p>
      )}

      {stage >= 2 && (
        <div className="mt-10 flex flex-wrap items-center gap-3 duration-calm-base ease-calm">
          {editMode.kind === "none" && (
            <Button variant="secondary" onClick={() => setEditMode({ kind: "merge", selected: new Set() })} disabled={busy}>
              Merge agents
            </Button>
          )}
          {editMode.kind === "merge" && (
            <>
              <p className="text-sm text-text-muted">Tap agents to merge, then confirm.</p>
              <Button onClick={handleMerge} disabled={busy || editMode.selected.size < 2}>
                Merge {editMode.selected.size > 0 ? `(${editMode.selected.size})` : ""}
              </Button>
              <Button variant="ghost" onClick={() => setEditMode({ kind: "none" })}>
                Cancel
              </Button>
            </>
          )}
          <Button variant="secondary" onClick={handleShare}>
            {shareStatus ?? "Share"}
          </Button>
        </div>
      )}

      {stage >= 2 && <FeedbackPrompt />}
      {stage >= 2 && <ClosingState />}

      {editMode.kind === "split" && (
        <SplitPanel
          agent={agentsById.get(editMode.agentId)}
          tasks={chart.tasks.filter((t) => agentsById.get(editMode.agentId)?.taskIds.includes(t.id))}
          selected={editMode.selected}
          label={editMode.label}
          busy={busy}
          onToggle={(taskId) => setEditMode((m) => (m.kind === "split" ? { ...m, selected: toggled(m.selected, taskId) } : m))}
          onLabelChange={(label) => setEditMode((m) => (m.kind === "split" ? { ...m, label } : m))}
          onConfirm={handleSplit}
          onCancel={() => setEditMode({ kind: "none" })}
        />
      )}
    </main>
  );
}

// MVP-0 tester gate (Phase B Step 6C): the one feedback question, asked
// once the reveal has actually settled (stage >= 2 — matching where the
// merge/share controls appear, i.e. once there's something real to react
// to). No dashboard polish, no vendor — a plain inline block that submits
// to the internal metrics store and then gets out of the way.
function FeedbackPrompt() {
  const [answer, setAnswer] = useState<boolean | null>(null);
  const [freeText, setFreeText] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  async function handleAnswer(taughtSomething: boolean) {
    setAnswer(taughtSomething);
    setSubmitting(true);
    setSaveError(null);
    try {
      await submitFeedback(taughtSomething);
      setSubmitted(true);
    } catch {
      setSaveError(SAVE_ERROR_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  }

  async function handleFreeTextSubmit() {
    if (answer === null) return;
    setSubmitting(true);
    setSaveError(null);
    try {
      await submitFeedback(answer, freeText.trim() || undefined);
      setSubmitted(true);
    } catch {
      setSaveError(SAVE_ERROR_MESSAGE);
    } finally {
      setSubmitting(false);
    }
  }

  if (submitted) {
    return (
      <Card className="mt-6">
        <p className="text-sm text-text-secondary">Thanks — that helps.</p>
      </Card>
    );
  }

  return (
    <Card className="mt-6 space-y-3">
      <p className="text-sm text-text">Did this teach you something about your business you hadn't thought about?</p>
      {answer === null ? (
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => handleAnswer(true)} disabled={submitting}>
            Yes
          </Button>
          <Button variant="secondary" onClick={() => handleAnswer(false)} disabled={submitting}>
            No
          </Button>
        </div>
      ) : (
        <div className="space-y-2">
          <textarea
            value={freeText}
            onChange={(e) => setFreeText(e.target.value)}
            placeholder="Anything specific? (optional)"
            rows={2}
            className="w-full resize-none rounded-md border border-border bg-bg-glass px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
          />
          <Button onClick={handleFreeTextSubmit} disabled={submitting}>
            Submit
          </Button>
        </div>
      )}
      {saveError && (
        <p role="alert" className="text-sm text-danger">
          {saveError}
        </p>
      )}
    </Card>
  );
}

// The preview's actual dead end (reported directly by a tester): nothing
// exists after the org chart, so the feedback prompt just trails off.
// This is deliberately not a product screen — plain text naming what's
// true today and what's next by name, one link out. No fake buttons, no
// screens that don't exist yet (role naming, BYOK, approvals/spend
// controls, the operating dashboard are all later Phase B/MVP-1 steps).
// Shown unconditionally alongside FeedbackPrompt, not gated on having
// answered it — skipping the feedback question shouldn't also hide the
// only way this page tells you it's actually over.
function ClosingState() {
  return (
    <Card className="mt-6 space-y-2">
      <p className="text-sm text-text">That's the preview, in full — this is where it stops today.</p>
      <p className="text-sm text-text-secondary">
        What's next: naming every agent, connecting your own AI key (BYOK, at cost), approvals and spending
        controls, and the operating dashboard where your company actually runs.
      </p>
      <Link
        to="/dashboard"
        className="inline-block text-sm font-medium text-accent transition-colors duration-calm-fast ease-calm hover:text-accent-strong"
      >
        Back to your dashboard →
      </Link>
    </Card>
  );
}

function toggled(set: Set<string>, id: string): Set<string> {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
}

function AgentCard({
  agent,
  tone,
  editable,
  renaming,
  onStartRename,
  onRename,
  selectableMode,
  onToggleMergeSelect,
  onStartSplit,
  handsStatus,
  onHandsConnected,
}: {
  agent: Agent;
  tone: BadgeTone;
  editable: boolean;
  renaming: boolean;
  onStartRename: () => void;
  onRename: (name: string) => void;
  selectableMode: EditMode;
  onToggleMergeSelect: () => void;
  onStartSplit: () => void;
  handsStatus: ReadonlyMap<string, HandsKeyStatus | null>;
  onHandsConnected: (tool: string, status: HandsKeyStatus) => void;
}) {
  const [draft, setDraft] = useState(agent.name);
  const [connectingTool, setConnectingTool] = useState<string | null>(null);
  const isMergeMode = selectableMode.kind === "merge";
  const isSelected = isMergeMode && selectableMode.selected.has(agent.id);

  return (
    <Card className={isSelected ? "border-accent" : undefined}>
      <div className="flex items-start justify-between gap-2">
        <div className="flex items-start gap-3">
          <span
            className={`flex size-10 shrink-0 items-center justify-center rounded-full border font-display text-sm font-semibold ${AVATAR_RING_CLASSES[tone]}`}
            aria-hidden="true"
          >
            {agent.name.charAt(0).toUpperCase()}
          </span>
          <div>
            {renaming ? (
              <input
                autoFocus
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onBlur={() => onRename(draft)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onRename(draft);
                  if (e.key === "Escape") onRename(agent.name);
                }}
                className="w-full rounded border border-accent bg-bg-glass px-2 py-1 font-display text-lg font-semibold text-text focus:outline-none"
              />
            ) : (
              // Name never appears without its title, right beneath it —
              // per userflow-v2.md's "Alex · CFO" convention.
              <button
                type="button"
                onClick={editable && !isMergeMode ? onStartRename : undefined}
                className="font-display text-lg font-semibold text-text disabled:cursor-default"
                disabled={!editable || isMergeMode}
              >
                {agent.name}
              </button>
            )}
            <p className="text-sm text-text-secondary">{agent.title}</p>
          </div>
        </div>
        {isMergeMode && (
          <input type="checkbox" checked={isSelected} onChange={onToggleMergeSelect} className="mt-1 h-4 w-4 accent-accent" />
        )}
      </div>

      {agent.complianceLocked && (
        <p className="mt-3 rounded-lg border border-danger/30 bg-danger/10 px-3 py-2 text-xs text-danger">
          🔒 Never autonomous — review with your professional before acting on this.
        </p>
      )}

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge tone="accent">{agent.tier}</Badge>
        {/* agent.riskTier can be missing on a stored org chart older than
            the field itself (see ceiling.ts's own comment on the exact
            same class of drift) — "low" is the same starting value
            mostRestrictiveStakes itself reduces from. */}
        <Badge tone={RISK_TIER_TONE[agent.riskTier ?? "low"]}>{RISK_TIER_LABEL[agent.riskTier ?? "low"]}</Badge>
        {agent.hands.map((tool) => {
          const status = handsStatus.get(`${agent.id}::${tool}`);
          if (status) {
            // Connected — informational only, no revoke UI here (that
            // lives on the provider's own site, per the "revoke anytime,
            // agents pause, nothing breaks" rule used throughout BYOK).
            return (
              <Badge key={tool} tone="money">
                ✓ {tool}
              </Badge>
            );
          }
          // #22's original panel is a single "paste an API key" input —
          // honest only for services that actually have a pasteable key
          // (docs/design/tool-registry.md §2b/§2e). authMethodForTool
          // (packages/templates, registry-driven so a new template
          // inherits the right behavior without a component change)
          // decides which of three affordances this badge offers: a real
          // paste-a-key flow, a real OAuth connect (PR 2B), or — until
          // either exists — the honest draft-mode message.
          const method = authMethodForTool(tool);
          if (method === "oauth-live") {
            const oauthService = oauthServiceForTool(tool);
            // oauthService is only null if an "oauth-live" entry forgot
            // to set it — handsAuth.test.ts fails CI on that, so this
            // branch is defensive, not an expected runtime state.
            if (oauthService) {
              return (
                <a
                  key={tool}
                  href={handsOAuthStartUrl(agent.id, tool, oauthService)}
                  className="inline-flex items-center rounded-full border border-border px-3 py-1 font-mono text-xs tracking-wide text-text-secondary transition-colors duration-calm-fast ease-calm hover:border-accent/50 hover:text-text"
                >
                  {tool} · connect
                </a>
              );
            }
          }
          const label = method === "key" ? "connect" : "draft only";
          return (
            <button
              key={tool}
              type="button"
              onClick={() => setConnectingTool(connectingTool === tool ? null : tool)}
              className="inline-flex items-center rounded-full border border-border px-3 py-1 font-mono text-xs tracking-wide text-text-secondary transition-colors duration-calm-fast ease-calm hover:border-accent/50 hover:text-text"
            >
              {tool} · {label}
            </button>
          );
        })}
      </div>

      {agent.brain && (
        <p className="mt-3 text-xs text-text-muted" title={agent.brain.reason}>
          <span className="font-mono uppercase tracking-[0.15em]">Brain: {agent.brain.provider}</span> — {agent.brain.reason}
        </p>
      )}

      {connectingTool && authMethodForTool(connectingTool) === "oauth-pending" && (
        <HandsOAuthPendingPanel agentName={agent.name} tool={connectingTool} onDismiss={() => setConnectingTool(null)} />
      )}

      {connectingTool && authMethodForTool(connectingTool) === "key" && (
        <HandsConnectPanel
          agentName={agent.name}
          tool={connectingTool}
          onConnected={(status) => {
            onHandsConnected(connectingTool, status);
            setConnectingTool(null);
          }}
          onSkip={() => setConnectingTool(null)}
          subAgentId={agent.id}
        />
      )}

      {editable && !isMergeMode && (
        <button type="button" onClick={onStartSplit} className="mt-3 text-xs text-text-muted underline underline-offset-4 hover:text-text-secondary">
          Split this agent
        </button>
      )}
    </Card>
  );
}

// Companion to HandsConnectPanel for OAuth-only services (see
// authMethodForTool, packages/templates/src/handsAuth.ts) — no input,
// nothing to submit. The agent is already, structurally, unable to act
// without this connection (#22's executor pre-flight check forces
// effect: undefined the moment a required Hands tool isn't connected —
// see docs/architecture/system-architecture.md §4), so this panel's only
// job is to stop the UI from implying a paste field would help. Dismiss
// just closes it — there is no "skip" action distinct from the default
// state, unlike HandsConnectPanel, because nothing was ever offered to
// decline.
function HandsOAuthPendingPanel({ agentName, tool, onDismiss }: { agentName: string; tool: string; onDismiss: () => void }) {
  return (
    <div className="mt-3 rounded-xl border border-border-subtle bg-bg-glass-subtle p-3.5">
      <p className="text-sm text-text-secondary">
        {agentName} drafts with <strong className="text-text">{tool}</strong> today — connecting it needs a sign-in
        flow we haven't built yet. It'll keep preparing the work for you to send yourself until then.
      </p>
      <button
        type="button"
        onClick={onDismiss}
        className="mt-2 text-xs text-text-muted underline underline-offset-4 hover:text-text-secondary"
      >
        Got it
      </button>
    </div>
  );
}

// Just-in-time Hands connect (issue #22, Screen 12: "connect now or skip;
// agents without tools work in draft mode"). Deliberately no per-service
// walkthrough content — unlike Brain's ConnectScreen, no product doc has
// written per-service mini-guides yet (docs/design/tool-registry.md is
// research/inventory, not copy-ready steps), so this stays honest: paste
// a key, or skip and the agent keeps working in draft mode either way.
// Only ever rendered for a tool authMethodForTool classifies as "key" —
// see HandsOAuthPendingPanel for the OAuth-only counterpart.
function HandsConnectPanel({
  agentName,
  subAgentId,
  tool,
  onConnected,
  onSkip,
}: {
  agentName: string;
  subAgentId: string;
  tool: string;
  onConnected: (status: HandsKeyStatus) => void;
  onSkip: () => void;
}) {
  const [apiKey, setApiKey] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setConnecting(true);
    setError(null);
    try {
      const status = await connectHandsKey(subAgentId, tool, apiKey);
      onConnected(status);
    } catch {
      setError(`Could not connect ${tool} — check the key and try again.`);
    } finally {
      setConnecting(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-border-subtle bg-bg-glass-subtle p-3.5">
      <p className="text-sm text-text-secondary">
        {agentName} wants to connect <strong className="text-text">{tool}</strong>. Until then, it works in draft
        mode — it'll prepare the work, you send it yourself.
      </p>
      <div className="mt-2.5 flex flex-col gap-2 sm:flex-row">
        <TextInput
          type="password"
          autoComplete="off"
          placeholder={`Paste your ${tool} API key`}
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          aria-label={`Paste your ${tool} API key`}
        />
        <Button variant="secondary" disabled={apiKey.trim().length === 0 || connecting} onClick={handleConnect}>
          {connecting ? "Connecting…" : "Connect"}
        </Button>
      </div>
      {error && <div className="mt-2"><FormError>{error}</FormError></div>}
      <button
        type="button"
        onClick={onSkip}
        className="mt-2 text-xs text-text-muted underline underline-offset-4 hover:text-text-secondary"
      >
        Skip for now
      </button>
    </div>
  );
}

function SplitPanel({
  agent,
  tasks,
  selected,
  label,
  busy,
  onToggle,
  onLabelChange,
  onConfirm,
  onCancel,
}: {
  agent: Agent | undefined;
  tasks: Task[];
  selected: Set<string>;
  label: string;
  busy: boolean;
  onToggle: (taskId: string) => void;
  onLabelChange: (label: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!agent) return null;
  return (
    <Card className="mt-6 space-y-3">
      <h3 className="font-display text-base font-semibold">Split {agent.name} · {agent.title}</h3>
      <p className="text-sm text-text-muted">Pick the tasks to break out into a new agent.</p>
      <ul className="space-y-2">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-center gap-2">
            <input type="checkbox" checked={selected.has(task.id)} onChange={() => onToggle(task.id)} className="h-4 w-4 accent-accent" />
            <span className="text-sm">{task.text}</span>
          </li>
        ))}
      </ul>
      <input
        value={label}
        onChange={(e) => onLabelChange(e.target.value)}
        placeholder="New agent's title…"
        className="w-full rounded-md border border-border bg-bg-glass px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
      />
      <div className="flex gap-2">
        <Button onClick={onConfirm} disabled={busy || selected.size === 0 || !label.trim()}>
          Split out
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Card>
  );
}
