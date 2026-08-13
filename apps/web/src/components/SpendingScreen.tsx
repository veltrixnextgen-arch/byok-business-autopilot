import { useEffect, useState } from "react";
import { getCeiling, InvalidCeilingError, setCeiling } from "../lib/brainKeyClient";
import { AppShell } from "./AppShell";
import { Button, Card, Field, FormError, TextInput } from "./ui";

type LoadState = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; companyMonthlyUsd: number; isOverride: boolean };

// Real data: the same TenantCeilingStore-backed GET/POST /me/ceiling
// ConnectScreen's onboarding wizard writes to (issue #15's "2-tap safety
// net") — this is the standalone, always-editable version of that same
// wall, reachable from the sidebar instead of only during first-time
// setup.
export function SpendingScreen() {
  const [state, setState] = useState<LoadState>({ kind: "loading" });
  const [draft, setDraft] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    getCeiling()
      .then((c) => {
        setState({ kind: "ready", ...c });
        setDraft(c.companyMonthlyUsd);
      })
      .catch((err: unknown) => setState({ kind: "error", message: String(err) }));
  }, []);

  async function handleSave() {
    if (draft === null) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const result = await setCeiling(draft);
      setState({ kind: "ready", ...result });
      setSaved(true);
    } catch (err) {
      setError(err instanceof InvalidCeilingError ? err.message : "Could not save your ceiling — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <AppShell active="/spending">
      <div className="mx-auto max-w-2xl px-6 py-16">
        <header className="mb-10 space-y-1">
          <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">Spending</p>
          <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Spending walls</h1>
          <p className="text-sm text-text-secondary">
            The most your agents can ever spend in a month, across every provider. Work is queued or skipped rather
            than going over it.
          </p>
        </header>

        {state.kind === "loading" && <p className="text-text-muted">Loading…</p>}
        {state.kind === "error" && (
          <p role="alert" className="rounded-lg border border-danger/30 bg-danger/10 px-3.5 py-2.5 text-sm text-danger">
            {state.message}
          </p>
        )}
        {state.kind === "ready" && (
          <Card>
            <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted">
              {state.isOverride ? "Your ceiling" : "Platform default — not yet customized"}
            </p>
            <div className="mt-4">
              <Field label="Monthly ceiling (USD)" htmlFor="spending-ceiling-input">
                <TextInput
                  id="spending-ceiling-input"
                  type="number"
                  min={1}
                  step="1"
                  value={draft ?? ""}
                  onChange={(e) => {
                    setSaved(false);
                    setDraft(e.target.value === "" ? null : Number(e.target.value));
                  }}
                />
              </Field>
            </div>

            {error && (
              <div className="mt-4">
                <FormError>{error}</FormError>
              </div>
            )}
            {saved && !error && <p className="mt-4 text-sm text-money">Saved.</p>}

            <Button variant="gradient" className="mt-6" disabled={draft === null || draft <= 0 || saving} onClick={handleSave}>
              {saving ? "Saving…" : "Save ceiling"}
            </Button>
          </Card>
        )}

        <p className="mt-6 text-xs text-text-muted">
          This is our backstop. Each provider's own console also lets you set a spend cap that holds even if our
          systems are ever down.
        </p>
      </div>
    </AppShell>
  );
}
