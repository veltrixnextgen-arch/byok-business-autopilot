// Integration suite — requires a real, migrated Postgres (DATABASE_URL).
// Run via `npm run test:integration` (packages/db), never as part of the
// regular `npm test`. See signupExtractionBatches.itest.ts's own header
// for the local/CI setup — identical here.
//
// Issue #18/ADR-045: migration 0015 is genuinely new schema
// (stripe_customer_id/stripe_subscription_id) — verified against a real
// Postgres, not just mocked, same discipline this session already
// applied to updateOrgChartForTenant.
import { createPool } from "./connection.js";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import assert from "node:assert/strict";
import { getTenantEligibilityFacts, getTenantStripeIds, getTenantTier, setTenantStripeIds, setTenantTier } from "./tenantSchedule.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required for the integration suite. Start the local stack (`docker compose up -d`), run " +
      "`npm run db:migrate`, then set DATABASE_URL — or run via `npm run test:integration` in CI.",
  );
}

const pool = createPool({ connectionString: DATABASE_URL, max: 5 });

async function seedTenant(): Promise<string> {
  const id = randomUUID();
  await pool.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)", [id, `itest-${id}`, "itest tenant"]);
  return id;
}

async function cleanup(tenantIds: string[]): Promise<void> {
  if (tenantIds.length) await pool.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [tenantIds]);
}

test("setTenantStripeIds persists both ids, readable back via a real query", async () => {
  const tenantId = await seedTenant();
  try {
    await setTenantStripeIds(pool, tenantId, { stripeCustomerId: "cus_live_1", stripeSubscriptionId: "sub_live_1" });
    const result = (await pool.query("SELECT stripe_customer_id, stripe_subscription_id FROM tenants WHERE id = $1::uuid", [
      tenantId,
    ])) as unknown as { rows: { stripe_customer_id: string | null; stripe_subscription_id: string | null }[] };
    assert.deepEqual(result.rows[0], { stripe_customer_id: "cus_live_1", stripe_subscription_id: "sub_live_1" });
  } finally {
    await cleanup([tenantId]);
  }
});

test("getTenantStripeIds round-trips setTenantStripeIds through the real function, not just a raw query, and defaults a never-set tenant to both null", async () => {
  const tenantId = await seedTenant();
  try {
    assert.deepEqual(await getTenantStripeIds(pool, tenantId), { stripeCustomerId: null, stripeSubscriptionId: null });
    await setTenantStripeIds(pool, tenantId, { stripeCustomerId: "cus_live_9", stripeSubscriptionId: "sub_live_9" });
    assert.deepEqual(await getTenantStripeIds(pool, tenantId), { stripeCustomerId: "cus_live_9", stripeSubscriptionId: "sub_live_9" });
  } finally {
    await cleanup([tenantId]);
  }
});

test("setTenantStripeIds can clear the subscription id back to null (cancellation), leaving the customer id alone", async () => {
  const tenantId = await seedTenant();
  try {
    await setTenantStripeIds(pool, tenantId, { stripeCustomerId: "cus_live_2", stripeSubscriptionId: "sub_live_2" });
    await setTenantStripeIds(pool, tenantId, { stripeCustomerId: "cus_live_2", stripeSubscriptionId: null });
    const result = (await pool.query("SELECT stripe_customer_id, stripe_subscription_id FROM tenants WHERE id = $1::uuid", [
      tenantId,
    ])) as unknown as { rows: { stripe_customer_id: string | null; stripe_subscription_id: string | null }[] };
    assert.deepEqual(result.rows[0], { stripe_customer_id: "cus_live_2", stripe_subscription_id: null });
  } finally {
    await cleanup([tenantId]);
  }
});

test("stripe_subscription_id must be unique across tenants — the real DB constraint, not just application discipline", async () => {
  const tenantA = await seedTenant();
  const tenantB = await seedTenant();
  try {
    await setTenantStripeIds(pool, tenantA, { stripeCustomerId: "cus_a", stripeSubscriptionId: "sub_shared" });
    await assert.rejects(() => setTenantStripeIds(pool, tenantB, { stripeCustomerId: "cus_b", stripeSubscriptionId: "sub_shared" }));
  } finally {
    await cleanup([tenantA, tenantB]);
  }
});

test("setTenantTier + getTenantTier round-trip for real, alongside a Stripe id write", async () => {
  const tenantId = await seedTenant();
  try {
    await setTenantTier(pool, tenantId, "solo");
    await setTenantStripeIds(pool, tenantId, { stripeCustomerId: "cus_live_3", stripeSubscriptionId: "sub_live_3" });
    assert.equal(await getTenantTier(pool, tenantId), "solo");
  } finally {
    await cleanup([tenantId]);
  }
});

test("the DB's own CHECK constraint rejects a tier other than 'solo' — the real backstop, not just the type", async () => {
  const tenantId = await seedTenant();
  try {
    await assert.rejects(() => pool.query("UPDATE tenants SET tier = 'scale' WHERE id = $1::uuid", [tenantId]));
  } finally {
    await cleanup([tenantId]);
  }
});

test("getTenantEligibilityFacts reads the real createdAt and subscription id together, and null-subscription for a never-subscribed tenant", async () => {
  const tenantId = await seedTenant();
  try {
    const facts = await getTenantEligibilityFacts(pool, tenantId);
    assert.equal(facts.stripeSubscriptionId, null);
    assert.ok(facts.createdAt instanceof Date);
    // Seeded moments ago — well within any sane clock-skew tolerance.
    assert.ok(Math.abs(Date.now() - facts.createdAt!.getTime()) < 60_000);

    await setTenantStripeIds(pool, tenantId, { stripeCustomerId: "cus_live_4", stripeSubscriptionId: "sub_live_4" });
    assert.equal((await getTenantEligibilityFacts(pool, tenantId)).stripeSubscriptionId, "sub_live_4");
  } finally {
    await cleanup([tenantId]);
  }
});

test("getTenantEligibilityFacts returns createdAt: null for a tenant id that doesn't exist -- fails closed, not open", async () => {
  const facts = await getTenantEligibilityFacts(pool, randomUUID());
  assert.equal(facts.createdAt, null);
  assert.equal(facts.stripeSubscriptionId, null);
});
