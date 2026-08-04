import type { InterviewAnswers, InterviewQuestion } from "@byok/contracts";
import { createFileRoute, redirect, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Button } from "../components/ui";
import { authClient } from "../lib/authClient";
import { fetchQuestions, loadIdea, startBatch } from "../lib/extractionClient";

export const Route = createFileRoute("/interview")({
  beforeLoad: async () => {
    const { data } = await authClient.getSession();
    if (!data) {
      throw redirect({ to: "/login" });
    }
  },
  component: Interview,
});

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

function Interview() {
  const navigate = useNavigate();
  const [idea] = useState(() => loadIdea());
  const [loading, setLoading] = useState(true);
  const [questions, setQuestions] = useState<InterviewQuestion[]>([]);
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [jurisdiction, setJurisdiction] = useState({ country: "", stateOrProvince: "" });
  const [guessedIds, setGuessedIds] = useState<Set<string>>(new Set());
  const [index, setIndex] = useState(0);
  const [phase, setPhase] = useState<"answering" | "submitting" | "error">("answering");
  const [submitError, setSubmitError] = useState<string | null>(null);

  useEffect(() => {
    if (!idea) {
      void navigate({ to: "/" });
      return;
    }
    fetchQuestions(idea).then((res) => {
      setQuestions(res.questions);
      const prefilled: Record<string, string> = {};
      const guessed = new Set<string>();
      for (const [key, value] of Object.entries(res.guess)) {
        if (key === "jurisdiction" || typeof value !== "string") continue;
        prefilled[key] = value;
        guessed.add(key);
      }
      setAnswers(prefilled);
      setGuessedIds(guessed);
      setLoading(false);
    });
    // idea is stable for this component's lifetime (loaded once from
    // sessionStorage) — this effect is meant to run once on mount.
  }, []);

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
    await refetchQuestions(next, jurisdiction);
    setIndex((i) => i + 1);
  }

  async function answerJurisdiction() {
    if (!jurisdiction.country.trim()) return;
    await refetchQuestions(answers, jurisdiction);
    setIndex((i) => i + 1);
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
    setSubmitError(null);
    try {
      const result = await startBatch(idea, buildFullAnswers(finalAnswers, finalJurisdiction));
      if (result.status === "completed") {
        await navigate({ to: "/tasks" });
        return;
      }
      setPhase("error");
      setSubmitError(result.status === "failed" ? result.error : `Not ready right now: ${result.reason}`);
    } catch (err) {
      setPhase("error");
      setSubmitError(err instanceof Error ? err.message : "Something went wrong.");
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

  if (phase === "submitting") {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-3 px-6 text-center">
        <p className="font-display text-2xl font-semibold duration-calm-base ease-calm">Building your company…</p>
        <p className="text-sm text-text-muted">This takes a few seconds — extracting tasks, assembling your team.</p>
      </main>
    );
  }

  if (phase === "error") {
    return (
      <main className="mx-auto flex min-h-screen max-w-lg flex-col items-center justify-center gap-4 px-6 text-center">
        <p role="alert" className="text-danger">
          {submitError}
        </p>
        <Button onClick={() => submit(answers, jurisdiction)}>Try again</Button>
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
          <h1 className="font-display text-2xl font-semibold">{q.prompt}</h1>

          {q.kind === "text" && (
            <TextQuestion value={answers[q.id] ?? ""} onSubmit={(v) => answerCurrent(v)} />
          )}

          {q.kind === "single-select" && (
            <div className="flex flex-wrap gap-2">
              {q.options?.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => answerCurrent(opt.value)}
                  className="rounded-full border border-border bg-bg-glass px-4 py-2 text-sm text-text transition-colors duration-calm-fast ease-calm hover:border-accent hover:text-accent data-[selected=true]:border-accent data-[selected=true]:text-accent"
                  data-selected={answers[q.id] === opt.value}
                >
                  {opt.label}
                </button>
              ))}
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

      <button type="button" onClick={skipTheRest} className="text-sm text-text-muted underline underline-offset-4 hover:text-text-secondary">
        Skip the rest — use defaults
      </button>
    </main>
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
