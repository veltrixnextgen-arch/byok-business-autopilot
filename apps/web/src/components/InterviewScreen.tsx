import type { InterviewAnswers, InterviewQuestion } from "@byok/contracts";
import { useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  ApiError,
  clearIdea,
  clearInterviewProgress,
  fetchQuestions,
  loadIdea,
  loadInterviewProgress,
  recordFunnelEvent,
  saveInterviewProgress,
  startBatch,
  type InterviewProgress,
} from "../lib/extractionClient";
import { type IllustrationStage, NetworkIllustration } from "./landing/NetworkIllustration";
import { Button, cx } from "./ui";

// A 401 here means the session that passed the route's beforeLoad has
// since expired — the only correct move is signing back in, not retrying
// the same request forever. Anything else (network blip, a 5xx) is
// retryable. Either way, "Skip the rest — use defaults" must stay
// reachable — a failed load is never allowed to be the only thing on
// screen with no way out.
type LoadErrorKind = "session-expired" | "network";
type InterviewError = { source: "submit"; message: string } | { source: "load"; kind: LoadErrorKind; retry: () => void };

function classifyLoadError(err: unknown): LoadErrorKind {
  return err instanceof ApiError && err.status === 401 ? "session-expired" : "network";
}

// Spine/context question ids match InterviewAnswers' own top-level field
// names exactly (contracts/interview.ts) — anything NOT in this set (and
// not "jurisdiction", handled separately below since it's a compound
// value) is a template-declared branch question, stored under
// branchAnswers instead. This is the one place that distinction is made;
// everything else here just renders whatever InterviewQuestion[] the
// server returned.
const SPINE_AND_CONTEXT_IDS = new Set(["whatCustomersPayFor", "whoTheCustomerIs", "howMoneyArrives", "howDeliveryReaches", "stage", "whoIsWorkingOnIt"]);

function firstOptionValue(q: InterviewQuestion): string {
  return q.options?.[0]?.value ?? "";
}

// Real phases of extractOrgChart (packages/agents/extraction/src/pipeline.ts):
// template selection, the CUSTOMIZE pass, then bottom-up assembly into
// agents/teams/roles — presented here as the same four-step narrative
// already public on /how-it-works (steps 02-05), not invented copy.
// Assembly is one real server-side step that produces both teams and
// agents together; splitting it into two rows here matches how the
// public page already frames it and isn't a claim about server timing.
const GENERATING_STEPS = ["Understanding your business", "Discovering the work", "Forming your teams", "Assigning your agents"] as const;

// startExtraction is a single opaque network call — there's no real
// incremental signal to drive this from, so progress here is an honest
// approximation, not fabricated precision: it ticks forward on a timer,
// but NEVER marks the final step done — that only happens implicitly, by
// this whole screen unmounting the instant the real call actually
// resolves (navigate-away on success, the error view on failure). So the
// UI never claims completion before the real work is actually done.
const GENERATING_STEP_MS = 1500;

function illustrationStageForStep(stepIndex: number): IllustrationStage {
  if (stepIndex <= 0) return 0;
  if (stepIndex === 1) return 1;
  return 2;
}

function useGeneratingStep(active: boolean): number {
  const [stepIndex, setStepIndex] = useState(0);

  useEffect(() => {
    if (!active) {
      setStepIndex(0);
      return;
    }
    // A reduced-motion visitor gets the final "still working" state
    // immediately rather than watching a ticking animation — same
    // principle as the landing page's own reduced-motion fallback
    // (components/landing/primitives.tsx's useRevealOnScroll).
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setStepIndex(GENERATING_STEPS.length - 1);
      return;
    }
    const timer = setInterval(() => {
      setStepIndex((i) => Math.min(i + 1, GENERATING_STEPS.length - 1));
    }, GENERATING_STEP_MS);
    return () => clearInterval(timer);
  }, [active]);

  return stepIndex;
}

// Split out of routes/interview.tsx (a plain export here, so it's directly
// testable) — TanStack Start's route-file compiler only lazy-splits a
// route's local `component`, and stops doing so the moment that same
// symbol is also exported for anything else, which would silently pull
// this whole screen back into the initial bundle. Keeping the actual UI
// here and letting interview.tsx just reference it as an import keeps
// both: the route still lazy-splits, and this is importable from a test.
export function InterviewScreen() {
  const navigate = useNavigate();
  const [idea] = useState(() => loadIdea());
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [jurisdiction, setJurisdiction] = useState({ country: "", stateOrProvince: "" });
  const [guessedIds, setGuessedIds] = useState<Set<string>>(new Set());
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"answering" | "submitting" | "error">("answering");
  const [error, setError] = useState<InterviewError | null>(null);
  const generatingStep = useGeneratingStep(phase === "submitting");

  // resume is only ever the value loadInterviewProgress() returned at
  // mount time (passed through, never re-read here) — resuming reruns
  // fetchQuestions with the SAME answers already given, so the returned
  // question list reflects the same branching state instead of a fresh
  // question 1, and answers/index/jurisdiction/guessedIds are restored
  // from what was saved rather than the freshly-guessed prefill (the
  // user's own prior answers always win over a guess).
  async function loadInitialQuestions(ideaValue: string, resume: InterviewProgress | null) {
    setLoading(true);
    try {
      const partial: Partial<InterviewAnswers> | undefined = resume
        ? {
            ...resume.answers,
            ...(resume.jurisdiction.country.trim()
              ? { jurisdiction: { country: resume.jurisdiction.country, stateOrProvince: resume.jurisdiction.stateOrProvince || undefined } }
              : {}),
          }
        : undefined;
      const res = await fetchQuestions(ideaValue, partial);
      setQuestions(res.questions);
      if (resume) {
        setAnswers(resume.answers);
        setGuessedIds(new Set(resume.guessedIds));
        setJurisdiction(resume.jurisdiction);
        setIndex(resume.index);
      } else {
        const prefilled: Record<string, string> = {};
        const guessed = new Set<string>();
        for (const [key, value] of Object.entries(res.guess)) {
          if (key === "jurisdiction" || typeof value !== "string") continue;
          prefilled[key] = value;
          guessed.add(key);
        }
        setAnswers(prefilled);
        setGuessedIds(guessed);
      }
      setLoading(false);
      setPhase("answering");
      setError(null);
    } catch (err) {
      setLoading(false);
      setPhase("error");
      setError({ source: "load", kind: classifyLoadError(err), retry: () => void loadInitialQuestions(ideaValue, resume) });
    }
  }

  useEffect(() => {
    if (!idea) {
      void navigate({ to: "/" });
      return;
    }
    recordFunnelEvent("interview");
    void loadInitialQuestions(idea, loadInterviewProgress());
    // idea is stable for this component's lifetime (loaded once from
    // sessionStorage) — this effect is meant to run once on mount.
  }, []);

  // Persists on every answer/index/jurisdiction change, not scattered
  // across each handler — one write path that can't fall behind a future
  // handler that forgets to call it. Skipped while still loading so the
  // transient empty initial state never overwrites a real saved resume
  // before loadInitialQuestions has applied it.
  useEffect(() => {
    if (loading || !idea) return;
    saveInterviewProgress({ answers, index, jurisdiction, guessedIds: Array.from(guessedIds) });
  }, [answers, index, jurisdiction, guessedIds, loading, idea]);

  async function refetchQuestions(nextAnswers: Record<string, string>, nextJurisdiction: typeof jurisdiction) {
    if (!idea) return;
    const partial: Partial<InterviewAnswers> = { ...nextAnswers } as Partial<InterviewAnswers>;
    if (nextJurisdiction.country.trim()) {
      partial.jurisdiction = { country: nextJurisdiction.country, stateOrProvince: nextJurisdiction.stateOrProvince || undefined };
    }
    const res = await fetchQuestions(idea, partial);
    setQuestions(res.questions);
  }

  async function answerCurrent(value: string) {
    const q = questions[index];
    if (!q) return;
    const next = { ...answers, [q.id]: value };
    setAnswers(next);
    setGuessedIds((prev) => {
      const copy = new Set(prev);
      copy.delete(q.id);
      return copy;
    });
    try {
      await refetchQuestions(next, jurisdiction);
      setIndex((i) => i + 1);
    } catch (err) {
      setPhase("error");
      setError({ source: "load", kind: classifyLoadError(err), retry: () => void answerCurrent(value) });
    }
  }

  async function answerJurisdiction() {
    if (!jurisdiction.country.trim()) return;
    try {
      await refetchQuestions(answers, jurisdiction);
      setIndex((i) => i + 1);
    } catch (err) {
      setPhase("error");
      setError({ source: "load", kind: classifyLoadError(err), retry: () => void answerJurisdiction() });
    }
  }

  function buildFullAnswers(finalAnswers: Record<string, string>, finalJurisdiction: typeof jurisdiction): InterviewAnswers {
    const branchAnswers: Record<string, string> = {};
    for (const q of questions) {
      if (q.id === "jurisdiction" || SPINE_AND_CONTEXT_IDS.has(q.id)) continue;
      branchAnswers[q.id] = finalAnswers[q.id] ?? "";
    }
    return {
      whatCustomersPayFor: finalAnswers.whatCustomersPayFor ?? "",
      whoTheCustomerIs: (finalAnswers.whoTheCustomerIs as InterviewAnswers["whoTheCustomerIs"]) ?? "both",
      howMoneyArrives: (finalAnswers.howMoneyArrives as InterviewAnswers["howMoneyArrives"]) ?? "not-sure",
      howDeliveryReaches: (finalAnswers.howDeliveryReaches as InterviewAnswers["howDeliveryReaches"]) ?? "not-sure",
      jurisdiction: {
        country: finalJurisdiction.country || "US",
        stateOrProvince: finalJurisdiction.stateOrProvince || undefined,
      },
      stage: (finalAnswers.stage as InterviewAnswers["stage"]) ?? "nothing-yet",
      whoIsWorkingOnIt: (finalAnswers.whoIsWorkingOnIt as InterviewAnswers["whoIsWorkingOnIt"]) ?? "solo",
      branchAnswers,
    };
  }

  async function submit(finalAnswers: Record<string, string>, finalJurisdiction: typeof jurisdiction) {
    if (!idea) return;
    setPhase("submitting");
    setError(null);
    try {
      const result = await startBatch(idea, buildFullAnswers(finalAnswers, finalJurisdiction));
      if (result.status === "completed") {
        // Done with the idea's one job (getting here) — clear it so a
        // later visit to /dashboard in this same tab doesn't read a
        // stale pending idea and bounce a returning user with a real org
        // chart straight back into the interview. Same reasoning for the
        // in-progress answers: this interview is genuinely finished, not
        // just navigated away from.
        clearIdea();
        clearInterviewProgress();
        await navigate({ to: "/tasks" });
        return;
      }
      setPhase("error");
      // result.reason (QUEUE/SKIP) is already plain language from the
      // backend (runExtractionBatch.ts) — no jargon prefix needed here.
      setError({
        source: "submit",
        message: result.status === "failed" ? result.error : result.reason,
      });
    } catch (err) {
      setPhase("error");
      setError({ source: "submit", message: err instanceof Error ? err.message : "Something went wrong." });
    }
  }

  function skipTheRest() {
    const filledAnswers = { ...answers };
    for (const q of questions) {
      if (q.id === "jurisdiction" || filledAnswers[q.id]) continue;
      filledAnswers[q.id] = firstOptionValue(q) || "not-sure";
    }
    const filledJurisdiction = jurisdiction.country.trim() ? jurisdiction : { country: "US", stateOrProvince: "" };
    void submit(filledAnswers, filledJurisdiction);
  }

  // Advancing past the last question submits — this effect (not the
  // click handlers themselves) is what notices "we just answered the
  // last one", since the question LIST can grow after each answer
  // (branch questions appearing mid-flow), so "index === length" can't be
  // checked synchronously at answer time.
  useEffect(() => {
    if (!loading && phase === "answering" && questions.length > 0 && index >= questions.length) {
      void submit(answers, jurisdiction);
    }
  }, [index, questions.length, loading]);

  if (!idea) return null;

  if (loading) {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center px-6 text-center">
        <p className="text-text-secondary duration-calm-base ease-calm">Reading your idea…</p>
      </main>
    );
  }

  if (phase === "error" && error) {
    if (error.source === "load") {
      const message =
        error.kind === "session-expired"
          ? "Your session expired. Sign in again to continue — or skip the rest and use defaults."
          : "Something went wrong loading your questions.";
      return (
        <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
          <p role="alert" className="text-danger">
            {message}
          </p>
          <div className="flex flex-wrap justify-center gap-3">
            {error.kind === "session-expired" ? (
              <Button onClick={() => navigate({ to: "/login" })}>Sign in</Button>
            ) : (
              <Button onClick={error.retry}>Try again</Button>
            )}
            <Button variant="secondary" onClick={skipTheRest}>
              Skip the rest — use defaults
            </Button>
          </div>
        </main>
      );
    }
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
        <p role="alert" className="text-danger">
          {error.message}
        </p>
        <Button onClick={() => submit(answers, jurisdiction)}>Try again</Button>
      </main>
    );
  }

  if (phase === "submitting") {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-8 px-6 text-center">
        <NetworkIllustration stage={illustrationStageForStep(generatingStep)} className="max-w-[280px]" />
        <div className="w-full space-y-1">
          <p className="font-display text-2xl font-semibold">Building your company…</p>
          <p className="text-sm text-text-muted">This takes a few seconds.</p>
        </div>
        <ul className="w-full space-y-3 text-left">
          {GENERATING_STEPS.map((label, i) => (
            <GeneratingStepRow key={label} label={label} state={i < generatingStep ? "done" : i === generatingStep ? "active" : "pending"} />
          ))}
        </ul>
      </main>
    );
  }

  const q = questions[index];
  const progress = questions.length > 0 ? Math.min(index / questions.length, 1) : 0;

  return (
    <main className="mx-auto flex min-h-screen max-w-lg flex-col justify-center gap-8 px-6">
      <div className="h-1 w-full overflow-hidden rounded-full bg-bg-glass">
        <div
          className="h-full rounded-full bg-accent transition-[width] duration-calm-base ease-calm"
          style={{ width: `${progress * 100}%` }}
        />
      </div>

      {q && (
        <div key={q.id} className="space-y-5 duration-calm-base ease-calm">
          {guessedIds.has(q.id) && (
            <p className="font-mono text-xs uppercase tracking-wide text-accent">We read your idea as this — confirm or correct</p>
          )}
          <h1 className="font-display text-3xl font-bold tracking-tight text-balance sm:text-4xl">{q.prompt}</h1>

          {q.kind === "text" && (
            <TextQuestion value={answers[q.id] ?? ""} onSubmit={(v) => answerCurrent(v)} />
          )}

          {q.kind === "single-select" && (
            <div className="space-y-3">
              {q.options?.map((opt) => {
                const selected = answers[q.id] === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => answerCurrent(opt.value)}
                    className="flex w-full items-center justify-between rounded-2xl border border-border bg-bg-glass px-5 py-4 text-left text-text transition-colors duration-calm-fast ease-calm hover:border-accent/50 data-[selected=true]:border-accent"
                    data-selected={selected}
                  >
                    <span>{opt.label}</span>
                    <span
                      className={cx(
                        "size-5 shrink-0 rounded-full border-2",
                        selected ? "border-accent bg-accent" : "border-border-strong",
                      )}
                    />
                  </button>
                );
              })}
            </div>
          )}

          {q.kind === "location" && (
            <div className="space-y-3">
              <input
                value={jurisdiction.country}
                onChange={(e) => setJurisdiction((j) => ({ ...j, country: e.target.value }))}
                placeholder="Country"
                className="w-full rounded-md border border-border bg-bg-glass px-3.5 py-2.5 text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
              />
              <input
                value={jurisdiction.stateOrProvince}
                onChange={(e) => setJurisdiction((j) => ({ ...j, stateOrProvince: e.target.value }))}
                placeholder="State / province (optional)"
                className="w-full rounded-md border border-border bg-bg-glass px-3.5 py-2.5 text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
              />
              <Button onClick={answerJurisdiction} disabled={!jurisdiction.country.trim()} className="w-full">
                Continue
              </Button>
            </div>
          )}
        </div>
      )}

      <div className="space-y-2 text-center">
        <p className="text-sm text-text-muted">One question at a time. Your answers shape the team.</p>
        <button
          type="button"
          onClick={skipTheRest}
          className="font-medium text-accent transition-colors duration-calm-fast ease-calm hover:text-accent-strong"
        >
          Skip the rest — figure it out from my description →
        </button>
      </div>
    </main>
  );
}

function GeneratingStepRow({ label, state }: { label: string; state: "done" | "active" | "pending" }) {
  return (
    <li className="flex items-center gap-3">
      <span
        aria-hidden="true"
        className={cx(
          "flex size-5 shrink-0 items-center justify-center rounded-full border text-[11px] transition-colors duration-calm-base ease-calm",
          state === "done" && "border-transparent bg-accent text-bg",
          state === "active" && "rw-breathe border-accent bg-accent/15 text-accent",
          state === "pending" && "border-border-strong text-transparent",
        )}
      >
        {state === "done" ? "✓" : "•"}
      </span>
      <span className={cx("text-sm transition-colors duration-calm-base ease-calm", state === "pending" ? "text-text-muted" : "text-text")}>{label}</span>
    </li>
  );
}

function TextQuestion({ value, onSubmit }: { value: string; onSubmit: (value: string) => void }) {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);

  return (
    <div className="space-y-3">
      <textarea
        value={local}
        onChange={(e) => setLocal(e.target.value)}
        rows={2}
        autoFocus
        className="w-full resize-none rounded-md border border-border bg-bg-glass px-3.5 py-2.5 text-text placeholder:text-text-muted focus:border-accent focus:outline-none"
      />
      <Button onClick={() => onSubmit(local)} disabled={!local.trim()} className="w-full">
        Continue
      </Button>
    </div>
  );
}
