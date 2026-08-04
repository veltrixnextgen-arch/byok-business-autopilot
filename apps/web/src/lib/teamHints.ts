import type { TeamHint } from "@byok/contracts";
import type { BadgeTone } from "../components/ui";

// A colored tone per team (STEP 7 design fidelity pass, shared by tasks.tsx
// and org-chart.tsx) — maps onto the reference's four team hues plus accent
// (founder) and danger (compliance, already this app's convention for the
// locked-agent banner). Not every TeamHint maps to a visually distinct hue
// in the reference (it only shows four), so a few share a tone by
// adjacency rather than each getting a bespoke color.
export const TEAM_HINT_TONE: Record<TeamHint, BadgeTone> = {
  founder: "accent",
  cfo: "money",
  sales: "money",
  cmo: "marketing",
  "product-dev": "marketing",
  support: "clients",
  people: "clients",
  ops: "operations",
  delivery: "operations",
  compliance: "danger",
};

/** Solid-fill Tailwind class per tone, for the small status dots next to
 *  team/task-group headers (STEP 7 design fidelity pass) — Badge's own
 *  tone classes are translucent (bg-{tone}/15), which reads too faint at
 *  dot size. */
export const DOT_TONE_CLASSES: Record<BadgeTone, string> = {
  accent: "bg-accent",
  money: "bg-money",
  clients: "bg-clients",
  marketing: "bg-marketing",
  operations: "bg-operations",
  danger: "bg-danger",
};
