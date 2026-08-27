// Integration suite — requires a real, migrated Postgres (DATABASE_URL).
// Run via `npm run test:integration` (packages/vault); see
// packages/db/src/signupExtractionBatches.itest.ts for how to run this
// locally / in CI.
//
// Vault durability (found during MVP-1 readiness audit): Brain/Hands key
// material and the per-tenant DEK that encrypts it moved from in-memory
// Maps to Postgres (see ./vaultKeyStore.ts, ./dekRecordStore.ts). Every
// encryption property — ciphertext-only storage, AAD scope-binding,
// SecretHandle's TTL-zeroing — already had a unit-test proof against the
// in-memory stores (../vault.test.ts); this file proves the SAME
// properties hold against a REAL Postgres, not just that the SQL is
// syntactically valid (see TRACKING.md's costByRefIds incident for why
// that distinction matters — a mocked pool never executes real SQL).
import { createPool, withTenantScope } from "@byok/db";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import { decrypt, encrypt, generateKey, type EncryptedBlob } from "../crypto.js";
import type { Kms } from "../kms.js";
import { ScopeBindingError, type RequesterIdentity } from "../types.js";
import { Vault } from "../vault.js";
import { PostgresDekRecordStore } from "./dekRecordStore.js";
import { PostgresVaultKeyStore } from "./vaultKeyStore.js";

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  throw new Error(
    "DATABASE_URL is required for the integration suite. Start the local stack (`docker compose up -d`), run " +
      "`npm run db:migrate`, then set DATABASE_URL — or run via `npm run test:integration` in CI, where the " +
      "workflow migrates a Postgres service container before this runs.",
  );
}

const pool = createPool({ connectionString: DATABASE_URL, max: 20 });

const ROUTER: RequesterIdentity = { kind: "router-service", serviceId: "router-1" };
const TENANT_USER: RequesterIdentity = { kind: "tenant-user", userId: "user-1" };

// Same AES-256-GCM envelope crypto as LocalKms/StagingKms, just backed by
// an in-memory master key instead of a file — avoids ADR-007's production
// guard and any filesystem side effect for a test run.
class TestKms implements Kms {
  private readonly masterKey = generateKey();
  async encryptDek(dek: Buffer): Promise<EncryptedBlob> {
    return encrypt(dek, this.masterKey);
  }
  async decryptDek(blob: EncryptedBlob): Promise<Buffer> {
    return decrypt(blob, this.masterKey);
  }
}

function makeVault(dekRecordStore = new PostgresDekRecordStore(pool)): Vault {
  return new Vault(new TestKms(), undefined, 60_000, undefined, undefined, new PostgresVaultKeyStore(pool), dekRecordStore);
}

async function seedTenant(): Promise<string> {
  const id = randomUUID();
  await pool.query("INSERT INTO tenants (id, slug, name) VALUES ($1, $2, $3)", [id, `itest-${id}`, "itest tenant"]);
  return id;
}

async function cleanup(tenantIds: string[]): Promise<void> {
  // ON DELETE CASCADE on tenant_deks/brain_keys/hands_keys means deleting
  // the tenant row is enough to clean up everything this suite writes.
  if (tenantIds.length) await pool.query("DELETE FROM tenants WHERE id = ANY($1::uuid[])", [tenantIds]);
}

test("round-trip through real Postgres storage: a stored Brain key decrypts back to the exact original plaintext", async () => {
  const vault = makeVault();
  const tenantId = await seedTenant();
  try {
    await vault.storeBrainKey({ tenantId, roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-real-secret") }, TENANT_USER);

    const { handle } = await vault.decryptBrainKey(tenantId, "cfo", ROUTER);
    await handle.use(async (plaintext) => {
      assert.equal(plaintext.toString("utf8"), "sk-ant-real-secret");
    });
  } finally {
    await cleanup([tenantId]);
  }
});

test("ciphertext only in Postgres: the raw brain_keys row never contains the plaintext, only opaque BYTEA material", async () => {
  const vault = makeVault();
  const tenantId = await seedTenant();
  try {
    const plaintext = "sk-ant-super-secret-value";
    await vault.storeBrainKey({ tenantId, roleId: "cfo", provider: "anthropic", plaintext: Buffer.from(plaintext) }, TENANT_USER);

    // RLS-protected table — an unscoped pool.query here isn't just wrong
    // isolation, it actively throws: the tenant_isolation policy's
    // `current_setting('app.tenant_id', true)::uuid` fails to cast an
    // unset setting's empty string to uuid (the same footgun documented in
    // TRACKING.md's RLS-unscoped-query incident). withTenantScope is what
    // every real caller uses; this raw SELECT is just peeking at the same
    // scoped row to verify what's actually stored.
    const raw = (await withTenantScope(pool, tenantId, (client) =>
      client.query(
        "SELECT material_ciphertext, material_iv, material_auth_tag FROM brain_keys WHERE tenant_id = $1::uuid",
        [tenantId],
      ),
    )) as unknown as { rows: { material_ciphertext: Buffer; material_iv: Buffer; material_auth_tag: Buffer }[] };
    const row = raw.rows[0];
    assert.ok(row, "the row must exist");
    assert.ok(Buffer.isBuffer(row.material_ciphertext) && row.material_ciphertext.length > 0);
    assert.ok(!row.material_ciphertext.includes(Buffer.from(plaintext)), "the plaintext must never appear verbatim inside the stored ciphertext");
    assert.notEqual(row.material_ciphertext.toString("utf8"), plaintext);
  } finally {
    await cleanup([tenantId]);
  }
});

test("AAD scope-binding survives the storage swap: claiming the wrong subAgent/capabilityScope fails cryptographically, not just an app check", async () => {
  const vault = makeVault();
  const tenantId = await seedTenant();
  try {
    const stored = await vault.storeHandsKey(
      { tenantId, subAgentId: "invoicing", capabilityScope: "stripe:invoices:write", service: "stripe", plaintext: Buffer.from("sk_live_real") },
      TENANT_USER,
    );

    await assert.rejects(
      () => vault.decryptHandsKey(tenantId, stored.id, { subAgentId: "finance-agent", capabilityScope: "stripe:payouts:write" }, ROUTER),
      ScopeBindingError,
    );

    // The correct claim still works — proves the mismatch above was really
    // about the wrong AAD, not a general decrypt failure.
    const handle = await vault.decryptHandsKey(tenantId, stored.id, { subAgentId: "invoicing", capabilityScope: "stripe:invoices:write" }, ROUTER);
    await handle.use(async (plaintext) => {
      assert.equal(plaintext.toString("utf8"), "sk_live_real");
    });
  } finally {
    await cleanup([tenantId]);
  }
});

test("SecretHandle's TTL-zeroing is unchanged by the storage swap: use() zeroes even when the key came from Postgres", async () => {
  const vault = makeVault();
  const tenantId = await seedTenant();
  try {
    await vault.storeBrainKey({ tenantId, roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-zero-me") }, TENANT_USER);
    const { handle } = await vault.decryptBrainKey(tenantId, "cfo", ROUTER);

    assert.equal(handle.isZeroed, false);
    await handle.use(async (plaintext) => {
      assert.equal(plaintext.toString("utf8"), "sk-ant-zero-me");
    });
    assert.equal(handle.isZeroed, true);
  } finally {
    await cleanup([tenantId]);
  }
});

test("RLS: a Brain key stored for tenant A is genuinely invisible to a lookup scoped as tenant B, not just app-level filtered", async () => {
  const vault = makeVault();
  const tenantA = await seedTenant();
  const tenantB = await seedTenant();
  try {
    await vault.storeBrainKey({ tenantId: tenantA, roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-tenant-a-key") }, TENANT_USER);

    // Same PostgresVaultKeyStore method tenant B would legitimately call —
    // scoped as tenant B via withTenantScope, but asking (deliberately)
    // about tenant A's own role id. RLS, not the WHERE clause's tenant_id
    // parameter, is what must return nothing here.
    const store = new PostgresVaultKeyStore(pool);
    const asTenantB = await store.getBrainKey(tenantB, "cfo");
    assert.equal(asTenantB, null, "tenant B must not be able to read tenant A's Brain key by guessing its role id");

    // And the real owner still can.
    const asTenantA = await store.getBrainKey(tenantA, "cfo");
    assert.ok(asTenantA, "tenant A must still be able to read its own key");
  } finally {
    await cleanup([tenantA, tenantB]);
  }
});

test("RLS: cross-tenant reads are blocked even when tenant B queries tenant A's exact Hands key id directly", async () => {
  const tenantA = await seedTenant();
  const tenantB = await seedTenant();
  try {
    const vault = makeVault();
    const stored = await vault.storeHandsKey(
      { tenantId: tenantA, subAgentId: "invoicing", capabilityScope: "stripe:invoices:write", service: "stripe", plaintext: Buffer.from("sk_live_a") },
      TENANT_USER,
    );

    const store = new PostgresVaultKeyStore(pool);
    const asTenantB = await store.getHandsKeyById(tenantB, stored.id);
    assert.equal(asTenantB, null, "tenant B must not be able to read tenant A's Hands key even by its exact id");
  } finally {
    await cleanup([tenantA, tenantB]);
  }
});

// The user's explicit ask: "confirm what happens to a key that was in
// memory when the process restarts mid-write — no partial records."
// Every real persistence op (putIfAbsent for a DEK, putBrainKey for a key
// record) is a single atomic Postgres statement, so a "crash" between two
// such statements can only ever leave a row fully committed or entirely
// absent — never a half-written one. This test simulates the exact crash
// window: a DEK gets created and persisted, then the process dies before
// the key record that would use it is ever written.
test("a process restart mid-write (DEK created, key record never written) leaves no partial record — only a harmless, reusable orphaned DEK", async () => {
  const tenantId = await seedTenant();
  try {
    const dekRecordStore = new PostgresDekRecordStore(pool);
    const kms = new TestKms();

    // Simulates DekStore.getOrCreateDek's own first write, called on its
    // own as if storeBrainKey never got to call putBrainKey afterward.
    const dek = generateKey();
    const encryptedDek = await kms.encryptDek(dek);
    const inserted = await dekRecordStore.putIfAbsent(tenantId, encryptedDek);
    assert.ok(inserted, "the DEK insert itself must succeed and commit independently of anything downstream");

    // "The process crashes" — no brain_keys row was ever written. Scoped
    // via withTenantScope — brain_keys is RLS-protected, and an unscoped
    // query against it throws rather than silently returning zero rows
    // (see the "ciphertext only" test above for why).
    const keyRows = (await withTenantScope(pool, tenantId, (client) =>
      client.query("SELECT 1 FROM brain_keys WHERE tenant_id = $1::uuid", [tenantId]),
    )) as unknown as { rows: unknown[] };
    assert.equal(keyRows.rows.length, 0, "no half-written key record can exist — Postgres statement-level atomicity means putBrainKey either fully ran or never ran");

    // "The process restarts" and a real store call comes in for the same
    // tenant: it must succeed and reuse the orphaned DEK (getOrCreateDek's
    // get-first path), not error and not create a second DEK row.
    const vault = new Vault(kms, undefined, 60_000, undefined, undefined, new PostgresVaultKeyStore(pool), dekRecordStore);
    await vault.storeBrainKey({ tenantId, roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-after-restart") }, TENANT_USER);

    const { handle } = await vault.decryptBrainKey(tenantId, "cfo", ROUTER);
    await handle.use(async (plaintext) => {
      assert.equal(plaintext.toString("utf8"), "sk-ant-after-restart");
    });

    // tenant_deks is RLS-protected too — same scoping requirement.
    const dekRows = (await withTenantScope(pool, tenantId, (client) =>
      client.query("SELECT count(*)::int AS count FROM tenant_deks WHERE tenant_id = $1::uuid", [tenantId]),
    )) as unknown as {
      rows: { count: number }[];
    };
    assert.equal(dekRows.rows[0]?.count, 1, "exactly one DEK row must exist — the orphaned one from before the 'restart', reused, never duplicated");
  } finally {
    await cleanup([tenantId]);
  }
});
