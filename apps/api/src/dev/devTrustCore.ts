import { join } from "node:path";
import { ApprovalQueue, MockEffectExecutor, PostgresDurableAutonomyStore } from "@byok/approval-queue";
import {
  CostGate,
  InMemoryDurableReservationStore,
  loadDefaultPricingTable,
  type PricingTable,
  type TierModelMap,
  type TierModelMapsByProvider,
} from "@byok/cost-gate";
import { TenantCeilingStore, type PoolLike } from "@byok/db";
import { InMemoryDurableDedupStore, InMemoryDurableTaskLedger, MockExecutor, Router } from "@byok/router";
import { LocalKms, PostgresDekRecordStore, PostgresVaultKeyStore, StagingKms, Vault, type HandsCredentialRefresher, type Kms } from "@byok/vault";
import type { TrustCoreDeps } from "../context.js";
import { createGoogleCalendarRefresher, GOOGLE_CALENDAR_SERVICE } from "../oauth/googleCalendar.js";
import { DEFAULT_MONTHLY_CEILING_USD } from "../routes/ceiling.js";

// Model ids here must exactly match packages/cost-gate/src/pricing-table.json
// (loaded below, not hand-duplicated — see loadDefaultPricingTable's own
// comment for why a hand-copied table previously drifted: this repo's T1
// entry was "claude-haiku-4-5", missing the "-20251001" suffix every real
// call — customize.ts, categoryValidator.ts, onboardingBatch.ts — actually
// uses, so cost estimation for the onboarding batch would have silently
// thrown UnknownModelError the moment it ran for real). Exported (not just
// used inline) so devTrustCore.test.ts can assert every model id referenced
// anywhere in this repo has a pricing entry, not just the ones this map
// happens to name.
export const DEV_TIER_MODEL_MAP: TierModelMap = {
  T1: "claude-haiku-4-5-20251001",
  T2: "claude-sonnet-4-6",
  T3: "claude-opus-4-6",
};

// Multi-provider AI (Phase 2 item 5, ADR-048): one TierModelMap per
// provider, keyed the same way pricing-table.json's own PricingEntry.provider
// is (see pricing.ts) — CostGate picks the right one per task based on the
// requested model's own provider, never a shared/ambiguous map. OpenAI and
// Google tier bands do NOT line up dollar-for-dollar with Anthropic's own
// T1/T2/T3 cutoffs (see ADR-048's research) — each provider's T1/T2/T3 here
// is that PROVIDER's own relative cheap/balanced/frontier tier, not a shared
// absolute price band. Google has no distinct frontier-tier model in its
// current lineup (its own flagship, gemini-2.5-pro, IS both its T2 and T3) —
// documented, not hidden: a "high-stakes" task on a Google-keyed role gets
// the same model a normal task would, with nowhere further to escalate to.
export const TIER_MODEL_MAPS_BY_PROVIDER: TierModelMapsByProvider = {
  anthropic: DEV_TIER_MODEL_MAP,
  openai: {
    T1: "gpt-5-nano",
    T2: "gpt-5",
    T3: "gpt-5-pro",
  },
  google: {
    T1: "gemini-2.5-flash-lite",
    T2: "gemini-2.5-pro",
    T3: "gemini-2.5-pro",
  },
};

export function loadDevPricingTable(): PricingTable {
  return loadDefaultPricingTable();
}

/** ADR-007-compliant KMS choice for every non-production entrypoint this
 *  file serves (local `npm run dev` AND the staging deploy — see
 *  start.ts's own comment on why staging deliberately reuses this dev
 *  wiring). STAGING_KMS_MASTER_KEY is generated fresh per deploy by
 *  deploy-staging.yml and has no local filesystem to persist a key file
 *  on; local dev has no such env var, so it falls back to a gitignored
 *  local key file (see LocalKms's own comment). Both guard against
 *  ever running in a real NODE_ENV=production process regardless. */
export function createDevKms(): Kms {
  const stagingMasterKey = process.env.STAGING_KMS_MASTER_KEY;
  if (stagingMasterKey) return new StagingKms(stagingMasterKey);
  return new LocalKms(join(process.cwd(), ".local-kms", "master.key"));
}

/**
 * Local-dev-only trust-core: real Router/CostGate/ApprovalQueue/Vault
 * classes, wired to the same in-memory implementations the trust-core
 * packages' own test suites use — genuinely functional, not a stub, but
 * single-process and reset on every restart. NOT for any deployed
 * environment: production must supply real pricing/ceiling config and a
 * real Postgres-backed PostgresReservationStore (see server.ts's own
 * comment on why that's deliberately not decided here), and ADR-008's
 * guard refuses to construct a Router in production without a
 * CostGate/ApprovalQueue regardless. This exists so `npm run dev` has
 * something real to run against everywhere else.
 *
 * InMemoryDurableReservationStore (not the old single shared
 * ReservationLedger) is what CostGate is built on: per-tenant ceiling
 * pools, real even in this dev wiring (issue #47's "single shared pool"
 * bug) — the only thing dev-only about it is that it still resets on
 * restart; swapping in PostgresReservationStore for a real deployment is
 * a one-line constructor change, same interface either way.
 *
 * The ceiling itself is now a real per-tenant CeilingConfigResolver
 * (issue #15) backed by TenantCeilingStore/Postgres — a tenant's own
 * "our monthly ceiling" setting genuinely gates its spend, not just a
 * process-wide constant every tenant shared before. `pool` is required
 * for this reason, unlike the rest of this file's dependencies.
 *
 * `google` (PR 2B) registers Vault's one real HandsCredentialRefresher so
 * far — omitted or undefined when GOOGLE_OAUTH_CLIENT_ID/SECRET aren't
 * set (server.ts), which is every environment today pending Google's app
 * verification (ADR-021). Vault itself is unaffected either way: an empty
 * refreshers map just means no "oauth" Hands key could ever be stored in
 * the first place, since nothing calls storeHandsKey with
 * credentialKind: "oauth" until handsOAuth.ts's callback route does.
 */
export function createDevTrustCore(pool: PoolLike, options: { google?: { clientId: string; clientSecret: string } } = {}): TrustCoreDeps {
  const pricingTable = loadDevPricingTable();
  const tenantCeilings = new TenantCeilingStore(pool);
  const ceilingResolver = async (tenantId: string) => {
    const override = await tenantCeilings.get(tenantId);
    return {
      companyMonthlyUsd: override ?? DEFAULT_MONTHLY_CEILING_USD,
      perRoleUsd: {},
      perTaskTypeUsd: {},
    };
  };

  const costGate = new CostGate(pricingTable, ceilingResolver, new InMemoryDurableReservationStore(), TIER_MODEL_MAPS_BY_PROVIDER);
  // Autonomy durability: PostgresDurableAutonomyStore, not the in-memory
  // AutonomyEngine this used to be — `pool` is already required here
  // (TenantCeilingStore above), so this follows the same direction the
  // rest of this file already takes (real durable pieces wherever a pool
  // is on hand), and it's what actually closes the accept-offer
  // split-brain: apps/api/src/routes/approvals.ts's accept-offer route
  // reads/writes this exact table, so `npm run dev` needs the same object
  // identity staging/production have to exercise that path meaningfully.
  const approvalQueue = new ApprovalQueue(new PostgresDurableAutonomyStore(pool), new MockEffectExecutor());
  // #120: dev-only in-memory ledger/dedup — guarded to refuse construction
  // outside dev/test (durable/ledgerStore.ts, durable/dedupStore.ts).
  // Postgres-backed for any deployed environment: see durableTrustCore.ts.
  const ledger = new InMemoryDurableTaskLedger();
  const router = new Router(ledger, new InMemoryDurableDedupStore(), new MockExecutor(), costGate, approvalQueue);

  const handsCredentialRefreshers = new Map<string, HandsCredentialRefresher>();
  if (options.google) {
    handsCredentialRefreshers.set(GOOGLE_CALENDAR_SERVICE, createGoogleCalendarRefresher(options.google));
  }
  // Vault durability: `pool` is already required here (TenantCeilingStore
  // above), so local dev gets the same real Postgres-backed key storage
  // staging/production do — a key connected via `npm run dev` now
  // survives a restart too, matching this file's own stated direction
  // (ADR-026) of dev sharing real durable pieces wherever a pool is
  // already on hand, not diverging further from staging/production.
  const vault = new Vault(
    createDevKms(),
    undefined,
    undefined,
    handsCredentialRefreshers,
    undefined,
    new PostgresVaultKeyStore(pool),
    new PostgresDekRecordStore(pool),
  );

  return { router, costGate, approvalQueue, vault, tierModelMaps: TIER_MODEL_MAPS_BY_PROVIDER };
}
