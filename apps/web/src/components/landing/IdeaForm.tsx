import { useNavigate } from "@tanstack/react-router";
import { type FormEvent, useId, useState } from "react";
import { authClient } from "../../lib/authClient";
import { saveIdea, summarizeWebsite } from "../../lib/extractionClient";
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

// ADR-058: website-as-input's own failure copy, one line per
// non-"completed" WebsiteSummaryResult status — never a dead end, always
// a clear reason plus the fallback that's about to happen (switching back
// to the text box).
const WEBSITE_SUMMARY_FALLBACK_MESSAGE: Record<string, string> = {
  "insufficient-content": "Couldn't find enough on that page to work with — describe your business instead.",
  "unsafe-url": "That URL isn't one we can read — describe your business instead.",
  unreachable: "Couldn't reach that site — describe your business instead.",
  queued: "We're at today's AI usage limit — describe your business instead.",
  skipped: "We're at today's AI usage limit — describe your business instead.",
  failed: "Couldn't read that site — describe your business instead.",
};

type InputMode = "text" | "url";

// Rendered twice on the landing page (hero + final CTA, matching the
// design reference) — each instance owns its own independent state,
// including which input mode it's in, same as two hand-written form pairs
// would.
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
  const [mode, setMode] = useState<InputMode>("text");
  const [idea, setIdea] = useState("");
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submittingLabel, setSubmittingLabel] = useState("One sec…");
  const [error, setError] = useState<string | null>(null);

  async function proceedWithIdea(finalIdea: string) {
    saveIdea(finalIdea);
    try {
      const { data } = await getSessionWithTimeout();
      await navigate({ to: data ? "/interview" : "/signup" });
    } catch {
      setSubmitting(false);
      setError(SUBMIT_ERROR_MESSAGE);
    }
  }

  async function handleTextSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = idea.trim();
    if (!trimmed) return;
    setSubmitting(true);
    setSubmittingLabel("One sec…");
    setError(null);
    // The idea itself is untouched on failure — `idea` state and the
    // textarea value were never cleared by this path, so a retry
    // (clicking the same button again, now re-enabled) resubmits exactly
    // what the user already typed.
    await proceedWithIdea(trimmed);
  }

  async function handleUrlSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmedUrl = url.trim();
    if (!trimmedUrl) return;
    setSubmitting(true);
    setSubmittingLabel("Reading your site…");
    setError(null);

    try {
      const result = await summarizeWebsite(trimmedUrl);
      if (result.status === "completed") {
        await proceedWithIdea(result.summary);
        return;
      }
      // Every non-"completed" status falls back to the plain-text box —
      // never a dead end. The URL the user typed stays in `url` state in
      // case they want to try a different one, but the active input
      // switches to text so they can keep going immediately either way.
      setMode("text");
      setSubmitting(false);
      setError(WEBSITE_SUMMARY_FALLBACK_MESSAGE[result.status] ?? "Couldn't read that site — describe your business instead.");
    } catch {
      setMode("text");
      setSubmitting(false);
      setError(SUBMIT_ERROR_MESSAGE);
    }
  }

  const canSubmit = mode === "text" ? idea.trim().length > 0 : url.trim().length > 0;

  return (
    <form onSubmit={mode === "text" ? handleTextSubmit : handleUrlSubmit} noValidate className={cx("w-full", className)}>
      <div className="mb-2 inline-flex rounded-full border border-white/10 bg-[rgba(16,20,34,0.6)] p-1 text-sm">
        <button
          type="button"
          onClick={() => setMode("text")}
          aria-pressed={mode === "text"}
          className={cx("rounded-full px-3 py-1 transition-colors", mode === "text" ? "bg-white/10 text-text" : "text-text-muted")}
        >
          Describe it
        </button>
        <button
          type="button"
          onClick={() => setMode("url")}
          aria-pressed={mode === "url"}
          className={cx("rounded-full px-3 py-1 transition-colors", mode === "url" ? "bg-white/10 text-text" : "text-text-muted")}
        >
          Paste your website
        </button>
      </div>
      <label htmlFor={inputId} className="sr-only">
        {mode === "text" ? "Your business idea" : "Your business website"}
      </label>
      <div className="group relative rounded-[22px] border border-white/10 bg-[rgba(16,20,34,0.82)] p-2 shadow-glow-cta backdrop-blur-md transition-colors duration-landing-hover ease-landing focus-within:border-accent/50">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
          {mode === "text" ? (
            <textarea
              id={inputId}
              value={idea}
              onChange={(e) => setIdea(e.target.value)}
              placeholder={placeholder}
              rows={1}
              className="w-full resize-none bg-transparent px-4 py-3 font-body text-base text-text placeholder:text-text-muted focus:outline-none sm:py-2.5"
            />
          ) : (
            <input
              id={inputId}
              type="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://yourbusiness.com"
              className="w-full bg-transparent px-4 py-3 font-body text-base text-text placeholder:text-text-muted focus:outline-none sm:py-2.5"
            />
          )}
          <button
            type="submit"
            disabled={submitting || !canSubmit}
            className="inline-flex shrink-0 items-center justify-center gap-2 rounded-full bg-gradient-to-br from-accent-strong to-cta-warm px-6 py-3 font-display text-[15px] font-semibold text-[#120c22] shadow-glow-cta transition-transform duration-landing-button ease-landing hover:-translate-y-px disabled:cursor-not-allowed disabled:opacity-45 sm:mb-1 sm:mr-1"
          >
            {submitting ? submittingLabel : mode === "text" ? buttonLabel : "Read my site"}
          </button>
        </div>
      </div>
      {error && <FormError>{error}</FormError>}
    </form>
  );
}
