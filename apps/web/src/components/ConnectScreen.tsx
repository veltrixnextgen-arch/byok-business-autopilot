import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  BRAIN_PROVIDERS,
  BrainKeyRejectedError,
  connectBrainKey,
  getBrainKeyStatus,
  getCeiling,
  InvalidCeilingError,
  setCeiling,
  type BrainKeyStatus,
  type BrainProvider,
} from "../lib/brainKeyClient";
import { Button, Card, Field, FormError, TextInput, cx } from "./ui";

interface ProviderGuide {
  label: string;
  tagline: string;
  consoleUrl: string;
  consoleLabel: string;
  steps: string[];
  billingUrl: string;
  keyPlaceholder: string;
  recommended?: boolean;
}

// Copy lifted directly from docs/product/roles-and-api-key-guide.md Part 3
// — the in-app walkthrough content is a product spec, not something to
// paraphrase. billingUrl is each console's own spend-limit page (step
// "Spend limit" in every guide below) — used by the safety-net step, not
// the walkthrough itself.
const PROVIDER_GUIDES: Record<BrainProvider, ProviderGuide> = {
  anthropic: {
    label: "Anthropic (Claude)",
    tagline: "Our recommended default — one key covers all three tiers. ~5 minutes.",
    consoleUrl: "https://console.anthropic.com",
    consoleLabel: "Open console.anthropic.com",
    billingUrl: "https://console.anthropic.com/settings/billing",
    keyPlaceholder: "sk-ant-...",
    recommended: true,
    steps: [
      "Go to console.anthropic.com → sign up with email or Google.",
      "Open Billing (in Settings) → add a payment method → load initial credit ($5 is plenty for the first weeks under our routing).",
      'Open API Keys → Create Key → name it "my-business-autopilot" (so it\'s recognizable later).',
      "The key appears once — copy it immediately and paste it below. (If you lose it, just create a new one; the old one can be deleted.)",
    ],
  },
  openai: {
    label: "OpenAI (GPT)",
    tagline: "Also complete tier coverage. ~5 minutes.",
    consoleUrl: "https://platform.openai.com",
    consoleLabel: "Open platform.openai.com",
    billingUrl: "https://platform.openai.com/settings/organization/limits",
    keyPlaceholder: "sk-...",
    steps: [
      "Go to platform.openai.com (the developer side — separate from a ChatGPT subscription, which does NOT include API access).",
      "Sign up / sign in → Billing → add payment method → add starting credit ($5).",
      "API Keys → Create new secret key → name it → copy immediately (shown once).",
    ],
  },
  google: {
    label: "Google (Gemini)",
    tagline: "Cheapest high-volume Tier 1 — great as a second provider for Support/Ops volume. ~5 minutes.",
    consoleUrl: "https://aistudio.google.com",
    consoleLabel: "Open aistudio.google.com",
    billingUrl: "https://console.cloud.google.com/billing",
    keyPlaceholder: "AIza...",
    steps: [
      "Go to aistudio.google.com → sign in with a Google account.",
      "Get API key → create key (in a new or existing Google Cloud project — the default it offers is fine).",
      "A free-quota tier exists but is rate-limited; for reliable agent work, enable billing on the project when prompted.",
    ],
  },
  deepseek: {
    label: "DeepSeek",
    tagline: "Optional, advanced — ultra-cheap Tier 1/2 alternative.",
    consoleUrl: "https://platform.deepseek.com",
    consoleLabel: "Open platform.deepseek.com",
    billingUrl: "https://platform.deepseek.com/usage",
    keyPlaceholder: "sk-...",
    steps: ["Go to platform.deepseek.com → sign up or sign in.", "Create an API key and copy it immediately.", "Add starting credit — DeepSeek is prepaid."],
  },
};

const PRIMARY_PROVIDERS: BrainProvider[] = ["anthropic", "openai", "google"];

type Step =
  | { kind: "loading" }
  | { kind: "connected-summary"; status: BrainKeyStatus }
  | { kind: "choose" }
  | { kind: "walkthrough"; provider: BrainProvider }
  | { kind: "ceiling"; provider: BrainProvider; status: BrainKeyStatus }
  | { kind: "spend-cap"; provider: BrainProvider }
  | { kind: "done" };

// BYOK connect flow (issue #15, roles-and-api-key-guide.md Part 3). v1
// scope: ONE provider choice for the whole company (Screen 9's own
// fallback case — "if every role kept the Claude default, that's ONE
// key") rather than the full per-role picker, since issue #13 (the
// role-card deck with a per-role Brain picker) doesn't exist yet and
// Agent.brain is always null in the current data model. Split out of
// routes/connect.tsx as a plain export for the same reason
// OrgChartScreen/InterviewScreen are: TanStack Start's route-file
// compiler only lazy-splits a route's local `component`.
export function ConnectScreen() {
  const [step, setStep] = useState<Step>({ kind: "loading" });
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    getBrainKeyStatus()
      .then((status) => setStep(status ? { kind: "connected-summary", status } : { kind: "choose" }))
      .catch(() => setStep({ kind: "choose" }));
  }, []);

  return (
    <main className="mx-auto max-w-3xl px-6 py-16">
      <header className="mb-10 space-y-1">
        <p className="font-mono text-xs uppercase tracking-[0.2em] text-text-muted">Connect</p>
        <h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Connect a Brain</h1>
        <p className="text-sm text-text-secondary">
          Your agents think using an AI provider's API key — yours, not ours. Paste it here, encrypted the moment it
          arrives; revoke it anytime with one tap.
        </p>
      </header>

      {step.kind === "loading" && <p className="text-text-muted">Loading…</p>}

      {step.kind === "connected-summary" && (
        <ConnectedSummary status={step.status} onReconnect={() => setStep({ kind: "choose" })} />
      )}

      {step.kind === "choose" && (
        <ProviderChoice
          showAdvanced={showAdvanced}
          onShowAdvanced={() => setShowAdvanced(true)}
          onChoose={(provider) => setStep({ kind: "walkthrough", provider })}
        />
      )}

      {step.kind === "walkthrough" && (
        <Walkthrough
          provider={step.provider}
          onBack={() => setStep({ kind: "choose" })}
          onConnected={(status) => setStep({ kind: "ceiling", provider: step.provider, status })}
        />
      )}

      {step.kind === "ceiling" && (
        <CeilingStep onSaved={() => setStep({ kind: "spend-cap", provider: step.provider })} />
      )}

      {step.kind === "spend-cap" && (
        <SpendCapStep provider={step.provider} onDone={() => setStep({ kind: "done" })} />
      )}

      {step.kind === "done" && (
        <Card className="text-center">
          <p className="font-display text-lg font-semibold text-text">You're all set.</p>
          <p className="mt-2 text-sm text-text-secondary">Your agents can now use your connected key.</p>
          <Link
            to="/dashboard"
            className="mt-6 inline-block font-medium text-accent transition-colors duration-calm-fast ease-calm hover:text-accent-strong"
          >
            Go to dashboard →
          </Link>
        </Card>
      )}
    </main>
  );
}

function ConnectedSummary({ status, onReconnect }: { status: BrainKeyStatus; onReconnect: () => void }) {
  const guide = PROVIDER_GUIDES[status.provider as BrainProvider] ?? null;
  return (
    <Card>
      <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">Connected</p>
      <p className="mt-2 font-display text-lg font-semibold text-text">{guide?.label ?? status.provider}</p>
      <p className="mt-1 font-mono text-sm text-text-muted">{status.maskedFingerprint}</p>
      <p className="mt-4 text-sm text-text-secondary">
        Your agents are already using this key. Revoke it anytime from the provider's own console — your agents pause,
        nothing breaks, reconnect whenever.
      </p>
      <Button variant="secondary" className="mt-6" onClick={onReconnect}>
        Connect a different key
      </Button>
    </Card>
  );
}

function ProviderChoice({
  showAdvanced,
  onShowAdvanced,
  onChoose,
}: {
  showAdvanced: boolean;
  onShowAdvanced: () => void;
  onChoose: (provider: BrainProvider) => void;
}) {
  const providers = showAdvanced ? BRAIN_PROVIDERS : PRIMARY_PROVIDERS;
  return (
    <div className="space-y-4">
      <Card className="bg-bg-glass/60">
        <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-text-muted">Before you paste anything</p>
        <ul className="mt-3 space-y-2 text-sm text-text-secondary">
          <li>An API key is like a debit card number for AI — treat it like one. Paste it only here, never into email or chat.</li>
          <li>Always set the provider's own spend limit (the last step of each guide). That's your backstop even if everything else fails.</li>
          <li>You can revoke a key anytime on the provider's site — your agents pause, nothing breaks, reconnect whenever.</li>
        </ul>
      </Card>

      <div className="grid gap-3 sm:grid-cols-2">
        {providers.map((provider) => {
          const guide = PROVIDER_GUIDES[provider];
          return (
            <button
              key={provider}
              type="button"
              onClick={() => onChoose(provider)}
              className={cx(
                "rounded-2xl border p-5 text-left transition-colors duration-calm-fast ease-calm hover:border-accent/50",
                guide.recommended ? "border-accent/40 bg-accent/5" : "border-border bg-bg-glass",
              )}
            >
              {guide.recommended && (
                <p className="mb-1.5 font-mono text-[9px] uppercase tracking-[0.15em] text-accent">Recommended</p>
              )}
              <p className="font-display text-base font-semibold text-text">{guide.label}</p>
              <p className="mt-1 text-xs text-text-muted">{guide.tagline}</p>
            </button>
          );
        })}
      </div>

      {!showAdvanced && (
        <button
          type="button"
          onClick={onShowAdvanced}
          className="text-sm text-text-secondary underline-offset-4 transition-colors duration-calm-fast ease-calm hover:text-text hover:underline"
        >
          Show advanced options (DeepSeek)
        </button>
      )}
    </div>
  );
}

function Walkthrough({
  provider,
  onBack,
  onConnected,
}: {
  provider: BrainProvider;
  onBack: () => void;
  onConnected: (status: BrainKeyStatus) => void;
}) {
  const guide = PROVIDER_GUIDES[provider];
  const [apiKey, setApiKey] = useState("");
  const [status, setStatus] = useState<"idle" | "validating" | "error">("idle");
  const [error, setError] = useState<string | null>(null);

  async function handleConnect() {
    setStatus("validating");
    setError(null);
    try {
      const key = await connectBrainKey(provider, apiKey);
      setStatus("idle");
      onConnected(key);
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof BrainKeyRejectedError
          ? err.message
          : "Something went wrong connecting that key — check your connection and try again.",
      );
    }
  }

  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="text-sm text-text-muted transition-colors duration-calm-fast ease-calm hover:text-text"
      >
        ← Choose a different provider
      </button>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <p className="font-display text-base font-semibold text-text">{guide.label}</p>
          <ol className="mt-4 space-y-3 text-sm text-text-secondary">
            {guide.steps.map((s, i) => (
              <li key={i} className="flex gap-3">
                <span className="font-mono text-xs text-text-muted">{i + 1}.</span>
                <span>{s}</span>
              </li>
            ))}
          </ol>
        </Card>

        <Card>
          <a
            href={guide.consoleUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex w-full items-center justify-center rounded-full border border-border bg-bg-glass px-5 py-2.5 font-body text-sm font-medium text-text transition-colors duration-calm-fast ease-calm hover:border-border-strong"
          >
            {guide.consoleLabel} ↗
          </a>

          <div className="mt-6 space-y-4">
            <Field label="Paste your API key" htmlFor="brain-key-input">
              <TextInput
                id="brain-key-input"
                type="password"
                autoComplete="off"
                placeholder={guide.keyPlaceholder}
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
            </Field>

            {error && <FormError>{error}</FormError>}

            <Button
              variant="gradient"
              className="w-full"
              disabled={apiKey.trim().length === 0 || status === "validating"}
              onClick={handleConnect}
            >
              {status === "validating" ? "Validating…" : "Validate & Connect"}
            </Button>
          </div>
        </Card>
      </div>
    </div>
  );
}

function CeilingStep({ onSaved }: { onSaved: () => void }) {
  const [value, setValue] = useState<number | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getCeiling()
      .then((c) => setValue(c.companyMonthlyUsd))
      .catch(() => setValue(50));
  }, []);

  async function handleSave() {
    if (value === null) return;
    setSaving(true);
    setError(null);
    try {
      await setCeiling(value);
      onSaved();
    } catch (err) {
      setError(err instanceof InvalidCeilingError ? err.message : "Could not save your ceiling — try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Card>
      <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">Connected — one more thing</p>
      <p className="mt-2 font-display text-lg font-semibold text-text">Set your monthly ceiling</p>
      <p className="mt-1 text-sm text-text-secondary">
        The most your agents can ever spend in a month, across every provider. We'll queue or skip work rather than go
        over it — editable anytime from your dashboard.
      </p>

      <Field label="Monthly ceiling (USD)" htmlFor="ceiling-input">
        <TextInput
          id="ceiling-input"
          type="number"
          min={1}
          step="1"
          value={value ?? ""}
          onChange={(e) => setValue(e.target.value === "" ? null : Number(e.target.value))}
        />
      </Field>

      {error && <FormError>{error}</FormError>}

      <Button variant="gradient" className="mt-4 w-full" disabled={value === null || value <= 0 || saving} onClick={handleSave}>
        {saving ? "Saving…" : "Save & continue"}
      </Button>
    </Card>
  );
}

function SpendCapStep({ provider, onDone }: { provider: BrainProvider; onDone: () => void }) {
  const guide = PROVIDER_GUIDES[provider];
  const [acknowledged, setAcknowledged] = useState(false);

  return (
    <Card>
      <p className="font-mono text-[10px] uppercase tracking-[0.15em] text-accent">Last step</p>
      <p className="mt-2 font-display text-lg font-semibold text-text">Set a spend cap on {guide.label}'s own site</p>
      <p className="mt-1 text-sm text-text-secondary">
        Your ceiling above is our backstop. A provider-side cap is the one that holds even if our systems are ever
        down — set it now, it only takes a minute.
      </p>

      <a
        href={guide.billingUrl}
        target="_blank"
        rel="noopener noreferrer"
        className="mt-6 inline-flex w-full items-center justify-center rounded-full border border-border bg-bg-glass px-5 py-2.5 font-body text-sm font-medium text-text transition-colors duration-calm-fast ease-calm hover:border-border-strong"
      >
        Open {guide.label}'s billing settings ↗
      </a>

      <Button variant="gradient" className="mt-3 w-full" onClick={onDone}>
        I've set my cap — finish
      </Button>

      <div className="mt-6 border-t border-border-subtle pt-4">
        <label className="flex items-start gap-2.5 text-sm text-text-secondary">
          <input
            type="checkbox"
            checked={acknowledged}
            onChange={(e) => setAcknowledged(e.target.checked)}
            className="mt-0.5"
          />
          I understand the risk of not setting a provider-side spend cap.
        </label>
        <Button variant="ghost" className="mt-2" disabled={!acknowledged} onClick={onDone}>
          Skip for now
        </Button>
      </div>
    </Card>
  );
}
