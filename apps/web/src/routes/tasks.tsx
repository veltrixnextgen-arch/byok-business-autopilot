import type { OrgChart, Task, TeamHint } from "@byok/contracts";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { Button, Card } from "../components/ui";
import { authClient } from "../lib/authClient";
import { getLatestBatch, reassemble, recordFunnelEvent } from "../lib/extractionClient";

export const Route = createFileRoute("/tasks")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession();
    if (!data) {
      throw redirect({ to: "/login" });
    }
  },
  component: TaskList,
});

function slugify(text: string): string {
  return text.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40);
}

function newCustomTask(text: string, teamHint: TeamHint): Task {
  const slug = slugify(text) || `task-${Date.now()}`;
  return {
    id: `customize.web.${slug}.${Date.now()}`,
    text,
    agentType: slug,
    agentLabel: text.slice(0, 40),
    teamHint,
    frequency: "adhoc",
    stakes: "low",
    tier: "T1",
    autonomy: "earnable",
    handsTool: null,
    origin: "customize-added",
  };
}

type LoadState = { kind: "loading" } | { kind: "waiting" } | { kind: "error"; message: string } | { kind: "ready"; batchId: string; chart: OrgChart };

function TaskList() {
  const navigate = useNavigate();
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [added, setAdded] = useState<Task[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      try {
        const batch = await getLatestBatch();
        if (cancelled) return;
        if (!batch) {
          await navigate({ to: "/" });
          return;
        }
        if (batch.status === "running") {
          // Extraction survives a tab close (ADR-014) — if we land here
          // mid-run (the batch started before this page loaded, or the
          // tab was reopened while it was still going), keep checking
          // rather than treating "not done yet" as an error.
          setState({ kind: "waiting" });
          pollTimer.current = setTimeout(load, 2000);
          return;
        }
        if (batch.status !== "completed" || !batch.orgChart) {
          setState({ kind: "error", message: batch.error ?? "Extraction didn't complete." });
          return;
        }
        recordFunnelEvent("tasks");
        setState({ kind: "ready", batchId: batch.id, chart: batch.orgChart });
      } catch (err) {
        if (!cancelled) setState({ kind: "error", message: err instanceof Error ? err.message : "Could not load your tasks." });
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (pollTimer.current) clearTimeout(pollTimer.current);
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

  const { chart, batchId } = state;
  const allTasks = [...chart.tasks, ...added];
  const byTeam = new Map<TeamHint, Task[]>();
  for (const task of allTasks) {
    const list = byTeam.get(task.teamHint) ?? [];
    list.push(task);
    byTeam.set(task.teamHint, list);
  }
  const teamTitle = (hint: TeamHint) => chart.teams.find((t) => t.id === hint)?.roleTitle ?? hint;
  const includedCount = allTasks.length - excluded.size;

  async function handleContinue() {
    const finalTasks = allTasks.filter((t) => !excluded.has(t.id));
    setSubmitting(true);
    try {
      await reassemble(batchId, finalTasks);
      await navigate({ to: "/org-chart" });
    } catch (err) {
      setState({ kind: "error", message: err instanceof Error ? err.message : "Could not save your changes." });
    }
  }

  return (
    <main className="mx-auto max-w-2xl px-6 py-16">
      <div className="mb-10 space-y-2 duration-calm-base ease-calm">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">Every task your idea needs</p>
        <h1 className="font-display text-3xl font-semibold">{includedCount} tasks, in plain language.</h1>
        <p className="text-text-secondary">Uncheck anything that doesn't apply. Add anything we missed.</p>
      </div>

      <div className="space-y-8">
        {[...byTeam.entries()].map(([teamHint, teamTasks]) => (
          <TeamGroup
            key={teamHint}
            title={teamTitle(teamHint)}
            tasks={teamTasks}
            excluded={excluded}
            onToggle={(id) =>
              setExcluded((prev) => {
                const next = new Set(prev);
                if (next.has(id)) next.delete(id);
                else next.add(id);
                return next;
              })
            }
            onAdd={(text) => setAdded((prev) => [...prev, newCustomTask(text, teamHint)])}
          />
        ))}
      </div>

      <Button onClick={handleContinue} disabled={submitting || includedCount === 0} className="mt-10 w-full">
        {submitting ? "Saving…" : "See the team behind these tasks"}
      </Button>
    </main>
  );
}

function TeamGroup({
  title,
  tasks,
  excluded,
  onToggle,
  onAdd,
}: {
  title: string;
  tasks: Task[];
  excluded: Set<string>;
  onToggle: (id: string) => void;
  onAdd: (text: string) => void;
}) {
  const [draft, setDraft] = useState("");

  return (
    <Card>
      <h2 className="mb-4 font-display text-lg font-semibold text-text-secondary">{title}</h2>
      <ul className="space-y-3">
        {tasks.map((task) => (
          <li key={task.id} className="flex items-start gap-3">
            <input
              type="checkbox"
              checked={!excluded.has(task.id)}
              onChange={() => onToggle(task.id)}
              className="mt-1 h-4 w-4 accent-accent"
            />
            <span className={excluded.has(task.id) ? "text-text-muted line-through" : "text-text"}>{task.text}</span>
          </li>
        ))}
      </ul>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (!draft.trim()) return;
          onAdd(draft.trim());
          setDraft("");
        }}
        className="mt-4 flex gap-2"
      >
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Add a task…"
          className="flex-1 rounded-md border border-border bg-bg-glass px-3 py-2 text-sm text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
        />
        <Button type="submit" variant="secondary">
          Add
        </Button>
      </form>
    </Card>
  );
}
