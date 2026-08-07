# Agent detail — `/app/agent/:id`

**Purpose:** a single agent's full profile — what it does, what it can touch, what it costs, and what it's done recently. Reached by clicking an agent's name from the Company screen (e.g. `/app/agent/maya`).

## Layout

Top to bottom, single column, generous vertical rhythm:

1. **Back link** — `← Company`, plain text, muted color, above everything else.
2. **Header row** — initials avatar (colored circle, e.g. "MA" on purple), then stacked `NAME` (large, uppercase-styled display type) and `Title · Team` (team name rendered in the team's accent color, e.g. purple for Growth) to its right. An autonomy pill (`AUTO` / `APPROVAL` / `LOCKED`) sits pinned to the top-right of the row, colored to match its state.
3. **Mandate line** — one sentence, larger/lighter body type, directly under the header (e.g. "Build steady, compounding demand without spending beyond the wall you set."). This is the agent's one-line purpose, not a task list.
4. **Three-card row** (equal width):
   - **Responsibilities** — bullet list, plain sentence fragments (e.g. "Campaign planning", "Content calendar", "Performance review").
   - **Allowed tools** — small pill/chip tags, uppercase mono, one per tool (e.g. `WEB RESEARCH`, `DRAFT EMAIL`, `ANALYTICS READ`, `CONTENT EDITOR`).
   - **Knowledge** — plain list of what the agent has context on (e.g. "Company charter", "Positioning notes", "Past campaign results").
5. **Second three-card row**:
   - **AI brain** — model name (e.g. "Claude Sonnet 4.6") with a "Change" button beside it, plus a caption: "Runs on your provider key. Usage is billed to you at cost."
   - **Daily budget** — dollar amount (e.g. "$1.00"), a caption showing actual usage ("est. $0.42 used/day"), and a slider control beneath it.
   - **Autonomy** — three stacked options rendered as radio-style rows, each with a label and a state pill: "Act without asking" / `AUTO`, "Ask me first" / `APPROVAL`, "Do not act" / `LOCKED`. The agent's current setting is visually selected/highlighted.
6. **Recent outputs** — a simple list, each row a one-line description of a completed action plus a relative timestamp (e.g. "Prepared 3 campaign concepts — 27m ago", "Reviewed last week's channel mix — 54m ago", "Drafted launch announcement — 81m ago").

## Notes for whoever builds this

- Nothing here needs new backend concepts beyond what the org/agent data model already has (responsibilities, tools/"hands", knowledge sources, model/brain, budget, autonomy) — this is presentation of existing agent fields, not a new data model, **except** "recent outputs," which implies an activity/audit log per agent that doesn't clearly exist yet on our side.
- The autonomy control here is the same three-state concept (`AUTO`/`APPROVAL`/`LOCKED`) already partially visible in our own `OrgChartScreen`'s tier badges — worth reconciling naming when this gets built rather than introducing a second vocabulary.
- The daily-budget slider implies a per-agent override on top of the company-wide wall — see `spending-settings.md` for the settings-level version of the same control.
