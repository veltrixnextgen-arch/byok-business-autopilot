import { Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import type { Charter, CompanyCharter } from "@byok/contracts";
import { acceptDraft, createDraft, getCharterState, updateDraft, type CharterAcceptResult } from "../lib/charterClient";
import { getOrgChartForTenant, loadIdea } from "../lib/extractionClient";
import { AppShell } from "./AppShell";
import { Button, Card } from "./ui";

type ScreenState =
  | { kind: "loading" }
  | { kind: "empty" }
  | { kind: "editing"; draft: CompanyCharter; ceoName: string | null }
  | { kind: "installed"; active: CompanyCharter }
  // Issue #135: a distinct state, not an immediate auto-navigate — what
  // the handoff actually scheduled needs to be seen, not just computed
  // and thrown away the way this screen used to.
  | { kind: "accepted"; sync: CharterAcceptResult["sync"] };

const SAVE_ERROR_MESSAGE = "Couldn't save that — try again.";

// The Stage 4 ceremony (master-plan-v2.md #10-11, docs/design/emergent-app-screens/charter.md,
// R2/ADR-024): idea -> MVP definition -> every role's mandate -> month-one
// goals -> budget ceiling, reviewable and editable, then handed to the CEO
// agent — which installs it as that agent's master prompt and cascades a
// system prompt to every role-lead and sub-agent (generateCascade,
// packages/agents/extraction). Split out of routes/charter.tsx for the
// same reason as every other screen here (see OrgChartScreen.tsx's comment
// on TanStack Start's lazy-splitting).
export function CharterScreen() {
  const navigate = useNavigate();
  const [state, setState] = useState<ScreenState>({ kind: "loading" });
  const [saving, setSaving] = useState(false);
  const [accepting, setAccepting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      const charterState = await getCharterState();
      if (cancelled) return;

      if (charterState.active && !charterState.draft) {
        setState({ kind: "installed", active: charterState.active });
        return;
      }

      const draft = charterState.draft ?? (await createDraft());
      if (cancelled) return;

      const batch = await getOrgChartForTenant().catch(() => null);
      const ceoAgent = batch?.orgChart?.agents.find((a) => a.teamId === "founder") ?? null;
      setState({ kind: "editing", draft, ceoName: ceoAgent?.name ?? null });
    }

    load()
      .catch(() => {
        if (!cancelled) setState({ kind: "empty" });
      });

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleSave(content: Charter) {
    if (state.kind !== "editing") return;
    setSaving(true);
    setError(null);
    try {
      const draft = await updateDraft(state.draft.id, content);
      setState({ ...state, draft });
    } catch {
      setError(SAVE_ERROR_MESSAGE);
    } finally {
      setSaving(false);
    }
  }

  async function handleAccept(content: Charter) {
    if (state.kind !== "editing") return;
    setAccepting(true);
    setError(null);
    try {
      await updateDraft(state.draft.id, content);
      const { sync } = await acceptDraft(state.draft.id);
      setState({ kind: "accepted", sync });
    } catch {
      setError("Couldn't hand off the Charter — try again.");
      setAccepting(false);
    }
  }

  return (
    <AppShell active="/charter">
      <div className="mx-auto max-w-3xl px-6 py-16">
        <header className="mb-10 space-y-1">
          {/* North star doc Tier 1 item 2: same framing eyebrow
              OrgChartScreen.tsx now uses — the Charter is the "why" half
              of the Company Blueprint, the org chart is the "who" half;
              same data either way, just named as one coherent whole. */}
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">
            Company charter · Part of your Company Blueprint
          </p>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">
            {state.kind === "installed" && "Your company's charter"}
            {state.kind === "accepted" && "Charter handed off"}
            {state.kind !== "installed" && state.kind !== "accepted" && "Review your charter"}
          </h1>
          <p className="text-text-secondary">
            {state.kind === "installed" && "The constitution of your AI company — installed as your CEO agent's master prompt."}
            {state.kind === "accepted" && "Here's what that actually scheduled."}
            {state.kind !== "installed" &&
              state.kind !== "accepted" &&
              "The idea, sharpened — the MVP — every role's mandate — this month's goals — your budget ceiling. Edit anything, then hand it off."}
          </p>
        </header>

        {state.kind === "loading" && <p className="text-sm text-text-muted">Loading…</p>}

        {state.kind === "empty" && <EmptyView />}

        {state.kind === "installed" && <InstalledView charter={state.active} />}

        {state.kind === "accepted" && <AcceptedView sync={state.sync} onContinue={() => navigate({ to: "/dashboard" })} />}

        {state.kind === "editing" && (
          <EditingView
            key={state.draft.id}
            draft={state.draft}
            ceoName={state.ceoName}
            saving={saving}
            accepting={accepting}
            error={error}
            onSave={handleSave}
            onAccept={handleAccept}
          />
        )}
      </div>
    </AppShell>
  );
}

// Previously a dead end: this state had no way back into the interview
// at all. Fixed honestly rather than implying a capability that doesn't
// exist — there is no "edit this company's existing answers in place"
// feature (claimLatestForTenant's own idempotency guard means a second
// claim for an already-claimed tenant just returns the existing batch,
// never a fresher one), so /interview only ever helps here if a real
// interview is genuinely still pending (loadIdea() returns something) —
// otherwise it silently bounces to "/" (InterviewScreen's own fallback),
// and continuing from there creates a brand new, separate company, not
// a change to this one. Branching the copy on loadIdea() up front means
// the link never claims more than it actually does.
function EmptyView() {
  const idea = loadIdea();
  return (
    <Card>
      <p className="text-sm text-text-secondary">There's no org chart to draft a Charter from yet.</p>
      {idea ? (
        <>
          <p className="mt-2 text-sm text-text-secondary">You have an interview in progress — finish it to continue.</p>
          <Link to="/interview" className="mt-3 inline-block text-sm font-medium text-accent hover:text-accent-strong">
            Resume the interview →
          </Link>
        </>
      ) : (
        <>
          <p className="mt-2 text-sm text-text-secondary">
            Starting a new interview creates a separate company — it won't change this one.
          </p>
          <Link to="/" className="mt-3 inline-block text-sm font-medium text-accent hover:text-accent-strong">
            Start a new company →
          </Link>
        </>
      )}
    </Card>
  );
}

function AcceptedView({ sync, onContinue }: { sync: CharterAcceptResult["sync"]; onContinue: () => void }) {
  const scheduledCount = sync?.added.length ?? 0;
  return (
    <Card>
      {sync ? (
        <>
          <p className="text-sm text-text-secondary">
            {scheduledCount > 0
              ? `${scheduledCount} task${scheduledCount === 1 ? "" : "s"} scheduled to run on cadence.`
              : "No cadence-triggered tasks to schedule yet."}
          </p>
          {sync.clampNotes.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-text-muted">
              {sync.clampNotes.map((note) => (
                <li key={note.taskId}>⚠ {note.reason}</li>
              ))}
            </ul>
          )}
        </>
      ) : (
        <p className="text-sm text-text-secondary">Nothing was scheduled yet — claim an org chart first.</p>
      )}
      <Button variant="gradient" className="mt-6" onClick={onContinue}>
        Continue to dashboard
      </Button>
    </Card>
  );
}

function InstalledView({ charter }: { charter: CompanyCharter }) {
  const c = charter.content;
  return (
    <div className="space-y-6">
      <Card>
        <h2 className="font-display text-base font-semibold text-text">The idea</h2>
        <p className="mt-3 text-sm text-text">{c.sharpenedIdea}</p>
        <p className="mt-3 text-sm text-text-secondary">{c.mvpDefinition}</p>
      </Card>
      <Card>
        <h2 className="font-display text-base font-semibold text-text">Month-one goals</h2>
        <ul className="mt-3 list-inside list-disc space-y-1 text-sm text-text">
          {c.monthOneGoals.map((g, i) => (
            <li key={i}>{g}</li>
          ))}
        </ul>
      </Card>
      <Card>
        <h2 className="font-display text-base font-semibold text-text">Every role's mandate</h2>
        <div className="mt-3 space-y-3">
          {c.roleMandates.map((rm) => (
            <div key={rm.roleTitle}>
              <p className="text-sm font-medium text-text">{rm.roleTitle}</p>
              <p className="text-sm text-text-secondary">{rm.mandate}</p>
            </div>
          ))}
        </div>
      </Card>
      <Card>
        <h2 className="font-display text-base font-semibold text-text">Budget ceiling</h2>
        <p className="mt-3 font-mono text-base font-semibold text-text">${c.budgetCeilingUsd.toFixed(2)}/month</p>
      </Card>
      <p className="text-xs text-text-muted">
        Version {charter.version} · installed {charter.installedAt ? new Date(charter.installedAt).toLocaleDateString() : "—"}
      </p>
    </div>
  );
}

function EditingView({
  draft,
  ceoName,
  saving,
  accepting,
  error,
  onSave,
  onAccept,
}: {
  draft: CompanyCharter;
  ceoName: string | null;
  saving: boolean;
  accepting: boolean;
  error: string | null;
  onSave: (content: Charter) => void;
  onAccept: (content: Charter) => void;
}) {
  const [content, setContent] = useState<Charter>(draft.content);

  return (
    <div className="space-y-6">
      <Card>
        <h2 className="font-display text-base font-semibold text-text">The idea</h2>
        <textarea
          className="mt-3 w-full rounded-md border border-border bg-bg-glass px-3.5 py-2.5 text-sm text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          rows={2}
          value={content.sharpenedIdea}
          onChange={(e) => setContent({ ...content, sharpenedIdea: e.target.value })}
        />
        <textarea
          className="mt-3 w-full rounded-md border border-border bg-bg-glass px-3.5 py-2.5 text-sm text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          rows={3}
          value={content.mvpDefinition}
          onChange={(e) => setContent({ ...content, mvpDefinition: e.target.value })}
        />
      </Card>

      <Card>
        <h2 className="font-display text-base font-semibold text-text">Month-one goals</h2>
        <div className="mt-3 space-y-2">
          {content.monthOneGoals.map((goal, i) => (
            <input
              key={i}
              className="w-full rounded-md border border-border bg-bg-glass px-3.5 py-2 text-sm text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
              value={goal}
              onChange={(e) => {
                const next = [...content.monthOneGoals];
                next[i] = e.target.value;
                setContent({ ...content, monthOneGoals: next });
              }}
            />
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="font-display text-base font-semibold text-text">Every role's mandate</h2>
        <div className="mt-3 space-y-4">
          {content.roleMandates.map((rm, i) => (
            <div key={rm.roleTitle}>
              <p className="text-sm font-medium text-text">{rm.roleTitle}</p>
              <textarea
                className="mt-1.5 w-full rounded-md border border-border bg-bg-glass px-3.5 py-2 text-sm text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
                rows={2}
                value={rm.mandate}
                onChange={(e) => {
                  const next = [...content.roleMandates];
                  next[i] = { ...next[i], mandate: e.target.value };
                  setContent({ ...content, roleMandates: next });
                }}
              />
            </div>
          ))}
        </div>
      </Card>

      <Card>
        <h2 className="font-display text-base font-semibold text-text">Budget ceiling</h2>
        <div className="mt-3 flex items-center gap-2">
          <span className="text-sm text-text-muted">$</span>
          <input
            type="number"
            min={1}
            step="0.01"
            className="w-32 rounded-md border border-border bg-bg-glass px-3.5 py-2 text-sm text-text focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
            value={content.budgetCeilingUsd}
            onChange={(e) => setContent({ ...content, budgetCeilingUsd: Number(e.target.value) })}
          />
          <span className="text-sm text-text-muted">/month</span>
        </div>
      </Card>

      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-3">
        <Button variant="secondary" onClick={() => onSave(content)} disabled={saving || accepting}>
          {saving ? "Saving…" : "Save changes"}
        </Button>
        <Button variant="gradient" onClick={() => onAccept(content)} disabled={saving || accepting}>
          {accepting ? "Handing off…" : `Hand the Charter to ${ceoName ?? "your CEO agent"}`}
        </Button>
      </div>
    </div>
  );
}
