import type { Cadence } from "@byok/contracts";

// Interval BullMQ's `repeat` job option fires on. Every cadence maps to a
// simple millisecond interval except "nightly", which maps to a cron
// pattern for a fixed off-peak hour (02:00 server time) — the distinction
// cadenceFloors.ts's own comment draws between "nightly" (a once-a-day
// batch, deliberately off-peak) and "daily" (once a day, no particular
// time implied). R3 ships cadence triggers only (plan §3a) — batching
// WITHIN that window (plan §6's "nightly-cadence agents batch their work
// into one call") is a property of how the worker processes a firing, not
// of the scheduler itself, and isn't built here.
export type BullMqRepeatOptions = { every: number } | { pattern: string };

const MINUTE_MS = 60_000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;

export function cadenceToRepeatOptions(cadence: Cadence): BullMqRepeatOptions {
  switch (cadence) {
    case "15min":
      return { every: 15 * MINUTE_MS };
    case "hourly":
      return { every: HOUR_MS };
    case "nightly":
      return { pattern: "0 2 * * *" }; // 02:00 daily, off-peak
    case "daily":
      return { every: DAY_MS };
    case "weekly":
      return { every: 7 * DAY_MS };
    case "monthly":
      return { pattern: "0 9 1 * *" }; // 09:00 on the 1st of the month
  }
}
