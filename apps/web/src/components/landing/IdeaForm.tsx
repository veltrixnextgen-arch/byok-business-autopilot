import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import { authClient } from "../../lib/authClient";
import { saveIdea } from "../../lib/extractionClient";
import { cx, FormError } from "../ui";

// Unchanged from the version verified live in PR #62/#64 (issue #61) — the
// missing-.catch() bug and its fix. Extracted here, byte-for-byte the same
// logic, only because the idea box now renders twice on the page (hero +
// final CTA, per the design reference) instead of once. Moving where this
// renders is a design decision; this function is not part of that change.
const GET_SESSION_TIMEOUT_MS = 15_000;

function getSessionWithTimeout(): Promise<Awaited<ReturnType<typeof authClient.getSession>>> {
  return Promise.race([
    authClient.getSession(),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timed out waiting for session")), GET_SESSION_TIMEOUT_MS)),
  ]);
}

const SUBMIT_ERROR_MESSAGE = "Couldn't reach the server — check your connection and try again.";

// Rendered twice on the landing page (hero + final CTA, matching the
// design reference) — each instance owns its own independent state, same
// as two hand-written <textarea>/<button> pairs would. Submitting either
// one does exactly the same thing: saveIdea() then route to /interview
// (signed in) or /signup (signed out).
export function IdeaForm({
  buttonLabel,
  placeholder = "I want to sell handmade candles online…",
  className,
}: {
  buttonLabel: string;
  placeholder?: string;
  className?: string;
}) {
  const navigate = useNavigate();
  const inputId = useId();
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
    <form onSubmit={handleSubmit} noValidate className={cx("w-full", className)}>
      <label htmlFor={inputId} className="sr-only">
        Your business idea
      </label>
      <div className="group relative rounded-[22px] border border-white/10 bg-[rgba(16,20,34,0.82)] p-2 shadow-glow-cta backdrop-blur-md transition-colors duration-calm-base ease-calm focus-within:border-accent/50">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <textarea
            id={inputId}
            value={idea}
            onChange={(e) => setIdea(e.target.value)}
            placeholder={placeholder}
            rows={1}
            className="w-full resize-none bg-transparent px-4 py-3 font-body text-base text-text placeholder:text-text-muted focus:outline-none sm:py-2.5"
          />
          <button
            type="submit"
            disabled={submitting || !idea.trim()}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-gradient-to-br from-accent-strong to-cta-warm px-6 py-3 font-display text-[15px] font-semibold text-[#120c22] shadow-glow-cta transition-transform duration-calm-fast ease-calm hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-45 sm:mb-1 sm:mr-1"
          >
            {submitting ? "One sec…" : buttonLabel}
          </button>
        </div>
      </div>
      {error && <FormError>{error}</FormError>}
    </form>
  );
}
