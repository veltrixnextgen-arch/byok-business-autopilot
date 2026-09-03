import { useEffect, useState } from "react";
import {
  acceptAutonomyOffer,
  getApprovals,
  resolveApproval,
  type ApprovalItem,
  type ApprovalsView,
  type AutonomyStatusEntry,
  type EffectResult,
} from "../lib/approvalsClient";
import { AppShell } from "./AppShell";
import { Badge, Button, Card } from "./ui";

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; view: ApprovalsView; index: number };

const AUTONOMY_THRESHOLD = 10; // DEFAULT_AUTONOMY_CONFIG.offerThreshold (autonomyEngine.ts)

function textareaClass(): string {
  return "w-full resize-none rounded-md border border-border bg-bg-glass px-3.5 py-2.5 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none";
}

// Issue: this is the daily home screen per userflow-v2 — one item at a
// time, not a scannable list (docs/design/emergent-app-screens/approvals.md),
// so every decision below optimizes for "read this one thing and act on
// it fast," not for browsing the whole queue.
export function ApprovalsScreen() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  // Surfaced separately from the queue itself: the item that carried this
  // result is already gone (resolved/removed) by the time this renders,
  // so it can't live in that item's own local state. issue #159's own
  // discipline — a real effect (e.g. a Resend send) that failed to
  // dispatch must be visible here, not just silently absorbed into
  // "the item disappeared from the queue."
  const [notice, setNotice] = useState<{ agentName: string; result: EffectResult } | null>(null);

  useEffect(() => {
    getApprovals()
      .then((view) => setState({ kind: "ready", view, index: 0 }))
      .catch((err: unknown) => setState({ kind: "error", message: String(err) }));
  }, []);

  function replaceView(updater: (view: ApprovalsView) => ApprovalsView) {
    setState((prev) => (prev.kind === "ready" ? { ...prev, view: updater(prev.view) } : prev));
  }

  function removeItemAndAdvance(id: string) {
    setState((prev) => {
      if (prev.kind !== "ready") return prev;
      const items = prev.view.items.filter((i) => i.id !== id);
      const index = Math.min(prev.index, Math.max(0, items.length - 1));
      return { ...prev, view: { ...prev.view, items }, index };
    });
  }

  return (
    <AppShell active="/approvals">
      <div className="mx-auto max-w-2xl px-4 py-10 sm:px-6 sm:py-16">
        <header className="mb-8 space-y-1">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">Approvals</p>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Approvals</h1>
        </header>

        {notice && (
          <div
            role="alert"
            className={`mb-6 rounded-lg border px-3.5 py-2.5 text-sm ${
              notice.result.success ? "border-money/30 bg-money/10 text-money" : "border-danger/30 bg-danger/10 text-danger"
            }`}
          >
            {notice.result.success ? (
              <>✓ Sent — {notice.agentName}'s action went out for real.</>
            ) : (
              <>✗ Approved, but the send failed: {notice.result.error}</>
            )}
            <button type="button" onClick={() => setNotice(null)} className="ml-3 underline underline-offset-2">
              Dismiss
            </button>
          </div>
        )}

        {state.kind === "loading" && <p className="text-text-muted">Loading…</p>}
        {state.kind === "error" && (
          <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
            {state.message}
          </p>
        )}

        {state.kind === "ready" && (
          <div className="space-y-8">
            <QueueCard
              view={state.view}
              index={state.index}
              onIndexChange={(index) => setState((prev) => (prev.kind === "ready" ? { ...prev, index } : prev))}
              onResolved={removeItemAndAdvance}
              onEffectResult={(agentName, result) => setNotice({ agentName, result })}
            />
            <AutonomySection autonomyStatus={state.view.autonomyStatus} onOfferAccepted={() => replaceView((v) => v)} refreshView={replaceView} />
          </div>
        )}
      </div>
    </AppShell>
  );
}

function QueueCard({
  view,
  index,
  onIndexChange,
  onResolved,
  onEffectResult,
}: {
  view: ApprovalsView;
  index: number;
  onIndexChange: (index: number) => void;
  onResolved: (id: string) => void;
  onEffectResult: (agentName: string, result: EffectResult) => void;
}) {
  const [mode, setMode] = useState<"view" | "reject" | "modify">("view");
  const [feedback, setFeedback] = useState("");
  const [editedOutput, setEditedOutput] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const item = view.items[index];

  if (view.items.length === 0) {
    return (
      <Card className="text-center">
        <p className="font-display text-base font-semibold text-text">Nothing waiting on you</p>
        <p className="mt-2 text-sm text-text-secondary">Your agents' work will show up here when it needs your sign-off.</p>
      </Card>
    );
  }

  if (!item) return null;

  function resetLocalState() {
    setMode("view");
    setFeedback("");
    setEditedOutput("");
    setError(null);
  }

  async function submit(verdict: Parameters<typeof resolveApproval>[2]) {
    if (!item) return;
    setSubmitting(true);
    setError(null);
    try {
      const result = await resolveApproval(item.id, item.kind, verdict);
      if (result.effectResult) onEffectResult(item.agentName, result.effectResult);
      onResolved(item.id);
      resetLocalState();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not resolve this item — try again.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Card>
      <div className="mb-4 flex items-center justify-between gap-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted">
          Item {index + 1} of {view.items.length}
        </p>
        {view.items.length > 1 && (
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={() => onIndexChange(Math.max(0, index - 1))}
              disabled={index === 0}
              aria-label="Previous item"
              className="rounded-full border border-border px-2.5 py-1 text-xs text-text-secondary disabled:opacity-30"
            >
              ←
            </button>
            <button
              type="button"
              onClick={() => onIndexChange(Math.min(view.items.length - 1, index + 1))}
              disabled={index === view.items.length - 1}
              aria-label="Next item"
              className="rounded-full border border-border px-2.5 py-1 text-xs text-text-secondary disabled:opacity-30"
            >
              →
            </button>
          </div>
        )}
      </div>

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-display text-base font-semibold text-text">{item.agentName}</p>
          <p className="mt-0.5 truncate text-sm text-text-secondary">{item.roleTitle}</p>
        </div>
        {item.neverEarnsAutonomy && <Badge tone="danger">Never earns autonomy</Badge>}
      </div>

      <p className="mt-4 text-sm font-medium text-text">{item.title}</p>

      <div className="mt-3 rounded-lg border border-border-subtle bg-bg px-3.5 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted">Output</p>
        <p className="mt-1.5 whitespace-pre-wrap text-sm text-text-secondary">{item.output}</p>
      </div>

      <div className="mt-3 rounded-lg border border-border-subtle bg-bg px-3.5 py-3">
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted">
          {item.effectDescription ? "If you approve this" : "If you mark this reviewed"}
        </p>
        <p className="mt-1.5 text-sm text-text-secondary">
          {
            // Week 1's narrow real-effect-dispatch scope (docs/STATUS.md):
            // item.effectDescription IS non-null now, for the one task
            // type wired to a real EffectExecutor (PR #218) — this branch
            // is live, not aspirational. Copy below (and the button
            // label) must say plainly that a real action fires on
            // approve, not just describe it passively while implying
            // "reviewed" is all that happens.
            item.effectDescription ?? "Nothing is sent, posted, or executed — this only marks the work reviewed."
          }
        </p>
      </div>

      <p className="mt-3 font-mono text-xs text-text-muted">{item.costUsd !== null ? `Cost: $${item.costUsd.toFixed(4)}` : "Cost: not tracked"}</p>

      {mode === "view" && (
        <div className="mt-6 grid grid-cols-3 gap-2">
          <Button variant="gradient" disabled={submitting} onClick={() => submit({ kind: "APPROVE" })}>
            {item.effectDescription ? "Approve & send" : "Mark reviewed"}
          </Button>
          <Button variant="secondary" disabled={submitting} onClick={() => setMode("modify")}>
            Modify
          </Button>
          <Button variant="secondary" disabled={submitting} onClick={() => setMode("reject")}>
            Reject
          </Button>
        </div>
      )}

      {mode === "reject" && (
        <div className="mt-6 space-y-3">
          <label htmlFor="reject-feedback" className="block text-sm font-medium text-text-secondary">
            Why? (required — this becomes feedback the agent learns from)
          </label>
          <textarea id="reject-feedback" rows={3} className={textareaClass()} value={feedback} onChange={(e) => setFeedback(e.target.value)} />
          <div className="flex gap-2">
            <Button variant="secondary" disabled={submitting} onClick={resetLocalState} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="gradient"
              disabled={submitting || feedback.trim().length === 0}
              onClick={() => submit({ kind: "REJECT", feedback: feedback.trim() })}
              className="flex-1"
            >
              {submitting ? "Rejecting…" : "Confirm reject"}
            </Button>
          </div>
        </div>
      )}

      {mode === "modify" && (
        <div className="mt-6 space-y-3">
          <label htmlFor="modify-output" className="block text-sm font-medium text-text-secondary">
            {item.effectDescription ? "Edit the output before it's sent" : "Edit the output before it's marked reviewed"}
          </label>
          <textarea
            id="modify-output"
            rows={5}
            className={textareaClass()}
            value={editedOutput || item.output}
            onChange={(e) => setEditedOutput(e.target.value)}
          />
          <div className="flex gap-2">
            <Button variant="secondary" disabled={submitting} onClick={resetLocalState} className="flex-1">
              Cancel
            </Button>
            <Button
              variant="gradient"
              disabled={submitting || (editedOutput || item.output).trim().length === 0}
              onClick={() => submit({ kind: "MODIFY", editedOutput: (editedOutput || item.output).trim() })}
              className="flex-1"
            >
              {submitting ? "Saving…" : item.effectDescription ? "Send with edits" : "Mark reviewed with edits"}
            </Button>
          </div>
        </div>
      )}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Card>
  );
}

function AutonomySection({
  autonomyStatus,
  refreshView,
}: {
  autonomyStatus: AutonomyStatusEntry[];
  onOfferAccepted: () => void;
  refreshView: (updater: (view: ApprovalsView) => ApprovalsView) => void;
}) {
  const [accepting, setAccepting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function handleAccept(taskType: string) {
    setAccepting(taskType);
    setError(null);
    try {
      await acceptAutonomyOffer(taskType);
      refreshView((v) => ({
        ...v,
        autonomyStatus: v.autonomyStatus.map((s) => (s.taskType === taskType ? { ...s, active: true, offeredAt: null } : s)),
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not accept this offer — try again.");
    } finally {
      setAccepting(null);
    }
  }

  return (
    <Card>
      <h2 className="font-display text-base font-semibold text-text">Autonomy status</h2>
      {autonomyStatus.length === 0 ? (
        <p className="mt-4 text-sm text-text-muted">
          No autonomy history yet — this fills in once a task type has been approved at least once.
        </p>
      ) : (
        <ul className="mt-4 divide-y divide-border-subtle">
          {autonomyStatus.map((s) => (
            <li key={s.taskType} className="flex items-center justify-between gap-3 py-3 first:pt-0 last:pb-0">
              <div className="min-w-0">
                <p className="truncate text-sm text-text">{s.taskType}</p>
                <p className="mt-0.5 font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted">
                  {s.active ? "Active" : `${s.consecutiveApprovals}/${AUTONOMY_THRESHOLD} toward offer`}
                </p>
              </div>
              {!s.active && s.offeredAt && (
                <Button variant="gradient" disabled={accepting === s.taskType} onClick={() => handleAccept(s.taskType)} className="shrink-0">
                  {accepting === s.taskType ? "Accepting…" : "Accept autonomy"}
                </Button>
              )}
              {s.active && <Badge tone="money">Active</Badge>}
            </li>
          ))}
        </ul>
      )}
      {error && <p className="mt-3 text-sm text-danger">{error}</p>}
    </Card>
  );
}
