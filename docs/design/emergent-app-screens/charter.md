# Company charter — `/app/charter`

**Purpose:** "the constitution of your AI company — one page describing how it is allowed to operate." A single readable document, not a settings form, with an Export action.

## Layout

Single page, document-style, top to bottom:

1. **Header** — "Company charter" (large heading) + one-line subtitle ("The constitution of your AI company — one page describing how it is allowed to operate.") + an **Export** button top-right.
2. **Labeled fields**, each a short heading (small caps / mono label style, matching the eyebrow treatment used elsewhere in the design system) followed by its value as plain prose or a short list:
   - **Company** — name + version tag (e.g. "social media scheduler · Version 1").
   - **Business model** — one line (e.g. "Monthly subscription · sold self-serve online").
   - **Location** — one line (e.g. "Fully global").
   - **Founder responsibilities** — prose, explicitly scoped down (e.g. "As little as possible — plus every approval in the queue. Nothing irreversible happens without you.").
   - **AI team responsibilities** — names the departments and agent count (e.g. "Growth · Operations · Finance · Customer Experience · Product — 9 agents covering discovery, delivery, money and customers.").
   - **Autonomy philosophy** — one governing sentence (e.g. "Agents may prepare anything. They may only send, spend or promise where you have said so explicitly.").
   - **Spending walls** — the company/agent/payment limits in one line (e.g. "COMPANY $10.00/DAY, AGENT $1.00/DAY, PAYMENTS LOCKED").
3. **Three lists**, each labeled and using the same tone-coded chip/badge treatment as elsewhere:
   - **Agents may act alone (AUTO)** — named agents.
   - **Requires approval** — named agents/action types.
   - **Locked actions** — named actions/agents that cannot act at all without a settings change.

## Notes for whoever builds this

- This reads as a generated *summary* of data that mostly already exists elsewhere (org structure, per-agent autonomy, spending walls) rather than a new source of truth — likely a read-only composed view, not a new data model, aside from the free-text fields (business model, location, founder responsibilities framing) which look like founder-provided or AI-drafted copy captured somewhere during onboarding.
- "Export" implies a PDF/markdown/print output — worth scoping what format before building.
- Directly reusable for `apps/web`: this is very close to what our own product docs (`master-plan-v2.md`) already call the Charter concept — check for an existing data shape before inventing one.
