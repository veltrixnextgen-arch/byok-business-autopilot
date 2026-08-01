import type { InterviewAnswers } from "./types.js";

// Explicit allowlist of jurisdictions the customize pass may name specific
// regulations/regulators for. Anywhere else, it must fall back to a generic
// "identify your local licensing/regulatory requirements" task instead of
// guessing — this is what the mortgage-brokerage fixture got wrong before
// jurisdiction was even collected (it invented US frameworks for an
// unspecified country). Narrow on purpose: only add an entry here once the
// frameworks named have actually been verified, not "sounds plausible."
interface JurisdictionCoverageEntry {
  /** Matches InterviewAnswers.jurisdiction.country, case-insensitive. */
  country: string;
  /** Matches stateOrProvince, case-insensitive. Omit to cover the whole country. */
  stateOrProvince?: string;
  /** What the customize pass is allowed to name for this jurisdiction, by domain. */
  coverage: string;
}

const JURISDICTION_COVERAGE: JurisdictionCoverageEntry[] = [
  {
    country: "US",
    coverage:
      "Mortgage/lending: NMLS (Nationwide Multistate Licensing System) registration, RESPA (Real Estate " +
      "Settlement Procedures Act) and TILA (Truth in Lending Act) disclosure requirements. State-specific " +
      "licensing rules vary by state and are NOT covered — if stateOrProvince isn't given or the specific " +
      "state's rules aren't known, still name the federal frameworks but add a generic 'check your state's " +
      "specific licensing requirements' task alongside them.",
  },
  {
    country: "CA",
    stateOrProvince: "BC",
    coverage:
      "Mortgage/lending: British Columbia mortgage brokers are regulated by the BC Financial Services " +
      "Authority (BCFSA) under the Mortgage Brokers Act. FINTRAC (Financial Transactions and Reports " +
      "Analysis Centre of Canada) anti-money-laundering/know-your-customer obligations apply federally.",
  },
];

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

export function findJurisdictionCoverage(jurisdiction: InterviewAnswers["jurisdiction"]): string | null {
  const country = normalize(jurisdiction.country);
  const state = jurisdiction.stateOrProvince ? normalize(jurisdiction.stateOrProvince) : undefined;

  for (const entry of JURISDICTION_COVERAGE) {
    if (normalize(entry.country) !== country) continue;
    if (entry.stateOrProvince && entry.stateOrProvince !== undefined) {
      if (!state || normalize(entry.stateOrProvince) !== state) continue;
    }
    return entry.coverage;
  }
  return null;
}

export function formatJurisdictionPolicy(jurisdiction: InterviewAnswers["jurisdiction"]): string {
  const jurisdictionLabel = jurisdiction.stateOrProvince
    ? `${jurisdiction.stateOrProvince}, ${jurisdiction.country}`
    : jurisdiction.country;
  const coverage = findJurisdictionCoverage(jurisdiction);

  if (coverage) {
    return (
      `Jurisdiction: ${jurisdictionLabel}. VERIFIED COVERAGE for this jurisdiction: ${coverage} ` +
      `You may name these specific frameworks/regulators in compliance-category tasks for this idea. ` +
      `Do not name anything beyond what's listed here even for this jurisdiction.`
    );
  }
  return (
    `Jurisdiction: ${jurisdictionLabel}. NO VERIFIED COVERAGE for this jurisdiction. Any compliance-category ` +
    `task you add for this idea MUST be a generic task like "Identify and track [domain]'s local licensing/` +
    `regulatory requirements for ${jurisdictionLabel}" — do NOT name any specific regulation, regulator, or ` +
    `licensing body you are not certain applies here. Guessing a named framework for an unverified ` +
    `jurisdiction is the single worst mistake this pass can make.`
  );
}
