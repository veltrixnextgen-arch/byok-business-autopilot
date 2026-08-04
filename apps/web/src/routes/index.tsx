import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { Button } from "../components/ui";
import { saveIdea } from "../lib/extractionClient";
import { authClient } from "../lib/authClient";

export const Route = createFileRoute("/")({
  component: Index,
});

// The idea box IS the start of onboarding (userflow-v2.md Stage 0/1) —
// typing into it is the whole interaction; "Sign up" only appears once
// there's something to carry forward. A signed-in user who lands here
// again (e.g. a bookmark) skips straight to the interview instead of
// being sent through signup a second time.
function Index() {
  const navigate = useNavigate();
  const [idea, setIdea] = useState("");
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = idea.trim();
    if (!trimmed) return;

    setSubmitting(true);
    saveIdea(trimmed);

    const { data } = await authClient.getSession();
    await navigate({ to: data ? "/interview" : "/signup" });
  }

  return (
    <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-10 px-6 text-center">
      <div className="space-y-4 duration-ceremony-slow ease-ceremony">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">Runwisely</p>
        <h1 className="font-display text-5xl font-semibold">
          Describe your idea. <span className="text-accent">Meet your company.</span>
        </h1>
        <p className="text-text-secondary">
          One line is enough. We'll turn it into a task list, a team, and an org chart — before you even sign up.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="w-full space-y-4">
        <textarea
          value={idea}
          onChange={(e) => setIdea(e.target.value)}
          placeholder="I want to sell handmade candles online…"
          rows={3}
          autoFocus
          className="w-full resize-none rounded-2xl border border-border bg-bg-glass px-5 py-4 text-center font-body text-lg text-text placeholder:text-text-muted transition-colors duration-calm-fast ease-calm focus:border-accent focus:outline-none"
        />
        {idea.trim() && (
          <Button type="submit" disabled={submitting} className="w-full duration-calm-base ease-calm">
            {submitting ? "One sec…" : "Meet your company"}
          </Button>
        )}
      </form>

      <nav className="text-sm text-text-muted">
        Already have an account? <Link to="/login" className="text-text-secondary underline underline-offset-4">Sign in</Link>
      </nav>
    </main>
  );
}
