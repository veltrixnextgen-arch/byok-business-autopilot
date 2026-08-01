import { readFileSync } from "node:fs";

// Pricing is data, not code — a versioned JSON table with a lastVerified
// date, not hardcoded constants scattered through estimator logic
// (security-architecture.md §6 lever #9: "keep the routing table current").
// The schema is provider-agnostic (every entry names its provider) even
// though this table is currently Anthropic-only.
export type Tier = "T1" | "T2" | "T3";

export interface PricingEntry {
  provider: string;
  tier: Tier;
  inputPerMTok: number;
  outputPerMTok: number;
}

export interface PricingTableData {
  version: number;
  /** ISO date (YYYY-MM-DD) this table's prices were last confirmed against
   *  the provider's actual pricing page. */
  lastVerified: string;
  prices: Record<string, PricingEntry>;
}

export const DEFAULT_STALE_AFTER_DAYS = 45;

export class StalePricingTableError extends Error {}
export class UnknownModelError extends Error {}

// Fail-closed, not just "fail with a nicer error": a stale table means we
// no longer trust our own cost estimates, so every price lookup refuses to
// answer rather than risk quoting a wrong (likely too-low) number.
export class PricingTable {
  constructor(
    private readonly data: PricingTableData,
    private readonly staleAfterDays: number = DEFAULT_STALE_AFTER_DAYS,
  ) {}

  assertFresh(now: Date = new Date()): void {
    const last = new Date(`${this.data.lastVerified}T00:00:00Z`);
    if (Number.isNaN(last.getTime())) {
      throw new StalePricingTableError(`Pricing table has an unparseable lastVerified date: "${this.data.lastVerified}".`);
    }
    const ageDays = (now.getTime() - last.getTime()) / (1000 * 60 * 60 * 24);
    if (ageDays > this.staleAfterDays) {
      throw new StalePricingTableError(
        `Pricing table last verified ${this.data.lastVerified} is ${Math.floor(ageDays)} days old ` +
          `(max ${this.staleAfterDays}). Refusing to price calls against stale data.`,
      );
    }
  }

  /** Throws StalePricingTableError or UnknownModelError — never returns a
   *  best-guess price. Callers (the estimator) must treat any throw here
   *  as "cannot estimate," which the gate then turns into QUEUE. */
  priceFor(model: string): PricingEntry {
    this.assertFresh();
    const entry = this.data.prices[model];
    if (!entry) {
      throw new UnknownModelError(`No pricing entry for model "${model}".`);
    }
    return entry;
  }

  modelsForTier(tier: Tier): string[] {
    this.assertFresh();
    return Object.entries(this.data.prices)
      .filter(([, entry]) => entry.tier === tier)
      .map(([model]) => model);
  }

  get lastVerified(): string {
    return this.data.lastVerified;
  }
}

export function loadPricingTable(path: string, staleAfterDays: number = DEFAULT_STALE_AFTER_DAYS): PricingTable {
  const data = JSON.parse(readFileSync(path, "utf-8")) as PricingTableData;
  return new PricingTable(data, staleAfterDays);
}
