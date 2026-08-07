import type { Agent, OrgChart, Task } from "@byok/contracts";
import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { getLatestBatch, reassemble, recordFunnelEvent, renameAgent, submitFeedback } from "../lib/extractionClient";
import { AVATAR_RING_CLASSES, DOT_TONE_CLASSES, TEAM_HINT_TONE } from "../lib/teamHints";
import { Badge, type BadgeTone, Button, Card } from "./ui";

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
        const batch = await getLatestBatch();
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
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center">
        <p className="text-text-secondary duration-calm-base ease-calm">
          {state.kind === "waiting" ? "Still building your company…" : "Loading…"}
        </p>
      </main>
    );
  }

  if (state.kind === "error") {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
        <p role="alert" className="text-danger">
          {state.message}
        </p>
        <Button onClick={() => navigate({ to: "/" })}>Start over</Button>
      </main>
    );
  }

  return <OrgChartReveal batchId={state.batchId} initialChart={state.chart} />;
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

  const nonHumanTeams = chart.teams.filter((t) => !t.isHuman);
  const agentsById = new Map(chart.agents.map((a) => [a.id, a]));

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
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">Your company</p>
        <h1 className="font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">
          Meet the team behind your business.
        </h1>
        <p className="text-text-secondary">
          {chart.agents.length} agents · {nonHumanTeams.length} teams · {chart.tasks.length} tasks covered
        </p>
      </div>

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
}) {
  const [draft, setDraft] = useState(agent.name);
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
        {agent.hands.map((tool) => (
          <Badge key={tool} tone="operations">
            {tool}
          </Badge>
        ))}
      </div>

      {editable && !isMergeMode && (
        <button type="button" onClick={onStartSplit} className="mt-3 text-xs text-text-muted underline underline-offset-4 hover:text-text-secondary">
          Split this agent
        </button>
      )}
    </Card>
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
