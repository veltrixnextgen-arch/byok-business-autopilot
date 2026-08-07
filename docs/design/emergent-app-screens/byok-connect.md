# BYOK connect — `/app/byok`

**Purpose:** the actual key-connection flow the landing page's `ByokExplainer.tsx` only describes. A guided wizard, not a single form.

## Layout

**5-step stepper** across the top: **Choose provider → Enter key → Test connection → Spending walls → Continue.** Current step highlighted, future steps dimmed/numbered, connected by a line — same stepper pattern as the reference's other multi-step flows (interview, onboarding structure).

**Step 1, Choose provider** (the step captured in full):
- Left column: provider cards, one per row, each showing the provider name and its available models as a subtitle, with a trailing arrow (implying click-to-select/expand):
  - **Anthropic** — Claude Sonnet 4.6, Haiku 4.5
  - **OpenAI** — GPT-5.5, GPT-5.4-mini
  - **Google** — Gemini 3.1 Pro, 3 Flash
- Right column: a persistent **"How this works"** side panel, present throughout the wizard (not just step 1), three numbered points:
  1. **Runwisely** — "Builds and runs your company structure."
  2. **Your AI provider** — "Supplies the intelligence your agents think with."
  3. **Usage billed directly** — "It appears on your provider's invoice, not ours."

Steps 2–5 (Enter key, Test connection, Spending walls, Continue) were not captured screen-by-screen this pass — only their labels, from the stepper. Worth a follow-up visit before building to see the actual key-entry field treatment (masked input, paste-only, format validation messaging) and what "Test connection" shows on success/failure.

## Notes for whoever builds this

- Direct UI for `packages/vault` (encryption, DEK store, KMS, secret handles) — the "Enter key" step is the one place a real secret gets typed, so treat that step's implementation with the same care as any credential-entry surface (this doc is a design record only; actual key handling needs its own security review when built, independent of visual fidelity).
- Step 4 "Spending walls" being folded into the BYOK wizard (rather than only living in Settings) suggests a founder sets an initial wall right after connecting a key, before any agent can spend — worth preserving that sequencing, not just the visual.
- Model names/pricing shown here (e.g. specific Claude/GPT/Gemini versions) are the reference's own placeholder content for its demo — do not copy them into `apps/web` as real supported-model claims; confirm actual supported models/versions with product before shipping copy.
