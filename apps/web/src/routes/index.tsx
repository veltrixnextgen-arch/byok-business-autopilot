import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { type FormEvent, useState } from "react";
import { authClient } from "../lib/authClient";
import { saveIdea } from "../lib/extractionClient";
import { LandingStory } from "../components/LandingStory";
import { Button, FormError } from "../components/ui";

export const Route = createFileRoute("/")({
  component: Index,
});

// This await chain (getSession, then navigate) had no error handling at
// all — the same missing-.catch() pattern issue #45 found on the
// interview screen's initial load, just one screen earlier this time. A
// rejected getSession() (wrong API base URL, network blip, a genuinely
// slow/unresponsive auth server) left setSubmitting(true) as the last
// state update that ever ran: the button stuck on "One sec…" forever,
// nothing to click, nothing to read, no way out. getSessionWithTimeout
// bounds the "slow, not failing" case explicitly — the try/catch below
// covers the "fails immediately" case (a wrong base URL fails fast with
// ERR_CONNECTION_REFUSED, not slowly) — both routes end up in the same
// recoverable error state, never a silent hang.
const GET_SESSION_TIMEOUT_MS = 15_000;

function getSessionWithTimeout(): Promise<Awaited<ReturnType<typeof authClient.getSession>>> {
  return Promise.race([
    authClient.getSession(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out waiting for session")), GET_SESSION_TIMEOUT_MS)),
  ]);
}

const SUBMIT_ERROR_MESSAGE = "Couldn't reach the server — check your connection and try again.";

// The idea box IS the start of onboarding (userflow-v2.md Stage 0/1) —
// typing into it is the whole interaction; "Sign up" only appears once
// there's something to carry forward. A signed-in user who lands here
// again (e.g. a bookmark) skips straight to the interview instead of
// being sent through signup a second time.
export function Index() {
  const navigate = useNavigate();
  const [idea, setIdea] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = idea.trim();
    if (!trimmed) return;

    setSubmitting(true);
    setError(null);
    saveIdea(trimmed);

    try {
      const { data } = await getSessionWithTimeout();
      await navigate({ to: data ? "/interview" : "/signup" });
    } catch {
      // The idea itself is untouched — `idea` state and the textarea
      // value were never cleared by this path, so a retry (clicking the
      // same button again, now re-enabled) resubmits exactly what the
      // user already typed.
      setSubmitting(false);
      setError(SUBMIT_ERROR_MESSAGE);
    }
  }

  return (
    <>
      <LandingStory />
      <main className="mx-auto flex min-h-screen max-w-2xl flex-col items-center justify-center gap-8 px-6 py-16 text-center sm:gap-10">
        <div className="space-y-4 duration-ceremony-slow ease-ceremony">
          <p className="font-mono text-xs uppercase tracking-[0.24em] text-accent/75">Act V · Your turn</p>
          <h1 className="font-display text-4xl font-bold tracking-tight text-balance sm:text-5xl">
            Describe your idea.
            <br />
            <span className="bg-gradient-to-r from-accent from-20% to-money to-80% bg-clip-text text-transparent">
              Meet your company.
            </span>
          </h1>
          <p className="text-text-secondary">
            One line is enough. We'll turn it into a task list, a team, and an org chart — before you even sign up.
          </p>
        </div>

        <form onSubmit={handleSubmit} className="w-full space-y-4">
          <div className="flex flex-col gap-2 rounded-2xl border border-accent/35 bg-bg-glass-strong p-2 shadow-glow-cta sm:flex-row sm:items-center">
            <textarea
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder="I want to sell handmade candles online…"
              rows={1}
              className="w-full resize-none bg-transparent px-3.5 py-3 font-body text-base text-text placeholder:text-text-muted focus:outline-none sm:py-2.5"
            />
            <Button
              type="submit"
              variant="gradient"
              disabled={submitting || !idea.trim()}
              className="w-full shrink-0 duration-calm-base ease-calm sm:w-auto"
            >
              {submitting ? "One sec…" : "Meet your company →"}
            </Button>
          </div>
          {error && <FormError>{error}</FormError>}
        </form>

        <p className="font-mono text-xs text-text-muted">No credit card · your own AI key, at cost · walls against surprise bills</p>

        <nav className="text-sm text-text-muted">
          Already have an account? <Link to="/login" className="text-text-secondary underline underline-offset-4">Sign in</Link>
        </nav>
      </main>
    </>
  );
}
