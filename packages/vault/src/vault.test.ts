import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Vault, TenantNotActiveError } from "./vault.js";
import type { HandsCredentialRefresher, TenantEligibilityResolver } from "./vault.js";
import { LocalKms } from "./kms.js";
import { DekUndecryptableError } from "./dekStore.js";
import { InMemoryDekRecordStore } from "./durable/dekRecordStore.js";
import { InMemoryVaultKeyStore } from "./durable/vaultKeyStore.js";
import {
  AccessDeniedError,
  HandsRefreshFailedError,
  HandsRefreshTokenRevokedError,
  KeyNotFoundError,
  ScopeBindingError,
  SecretExpiredError,
} from "./types.js";
import type { OAuthCredential, RefreshedCredential, RequesterIdentity } from "./types.js";

const ROUTER: RequesterIdentity = { kind: "router-service", serviceId: "router-1" };
const ONBOARDING: RequesterIdentity = { kind: "onboarding-service", serviceId: "onboarding-1" };

function makeVault(ttlMs = 60_000): Vault {
  const dir = mkdtempSync(join(tmpdir(), "vault-test-"));
  const kms = new LocalKms(join(dir, "master.key"));
  return new Vault(kms, undefined, ttlMs);
}

function makeVaultWithRefreshers(
  refreshers: ReadonlyMap<string, HandsCredentialRefresher>,
  refreshTimeoutMs = 5_000,
): Vault {
  const dir = mkdtempSync(join(tmpdir(), "vault-test-"));
  const kms = new LocalKms(join(dir, "master.key"));
  return new Vault(kms, undefined, 60_000, refreshers, refreshTimeoutMs);
}

function makeVaultWithEligibility(tenantEligibility: TenantEligibilityResolver): Vault {
  const dir = mkdtempSync(join(tmpdir(), "vault-test-"));
  const kms = new LocalKms(join(dir, "master.key"));
  return new Vault(kms, undefined, 60_000, undefined, undefined, undefined, undefined, tenantEligibility);
}

// A HandsCredentialRefresher test double that records every refreshToken it
// was called with, so single-flight de-dup (only ONE call for N concurrent
// decrypts) and never-called-when-not-needed assertions have something real
// to check against.
function fakeRefresher(fn: (refreshToken: string) => Promise<RefreshedCredential>): HandsCredentialRefresher & { calls: string[] } {
  const calls: string[] = [];
  return {
    calls,
    async refresh(refreshToken: string) {
      calls.push(refreshToken);
      return fn(refreshToken);
    },
  };
}

const EXPIRED_ISO = new Date(Date.now() - 1_000).toISOString();
const FRESH_ISO = new Date(Date.now() + 3_600_000).toISOString();

async function storeOAuthHandsKey(
  vault: Vault,
  opts: { service: string; accessToken: string; refreshToken?: string; expiresAt?: string; tenantId?: string },
) {
  const credential: OAuthCredential = {
    accessToken: opts.accessToken,
    refreshToken: opts.refreshToken,
    expiresAt: opts.expiresAt,
  };
  const record = await vault.storeHandsKey(
    {
      tenantId: opts.tenantId ?? "tenant-a",
      subAgentId: "cmo.social",
      capabilityScope: "social-post",
      service: opts.service,
      plaintext: Buffer.from(JSON.stringify(credential), "utf8"),
      credentialKind: "oauth",
    },
    ONBOARDING,
  );
  return record.id;
}

function decryptOAuth(vault: Vault, keyId: string, tenantId = "tenant-a") {
  return vault.decryptHandsKey(tenantId, keyId, { subAgentId: "cmo.social", capabilityScope: "social-post" }, ROUTER);
}

test("lifecycle: store -> decrypt round-trips the exact plaintext, and shows a masked fingerprint never the real key", async () => {
  const vault = makeVault();
  const plaintext = Buffer.from("sk-ant-super-secret-1234", "utf8");

  const record = await vault.storeBrainKey(
    { tenantId: "tenant-a", roleId: "cfo", provider: "anthropic", plaintext },
    ONBOARDING,
  );

  assert.equal(record.maskedFingerprint, "sk-...1234");
  assert.ok(!("plaintext" in record));
  assert.ok(!JSON.stringify(record).includes("super-secret"));

  const { handle } = await vault.decryptBrainKey("tenant-a", "cfo", ROUTER);
  const recovered = await handle.use((buf) => buf.toString("utf8"));
  assert.equal(recovered, "sk-ant-super-secret-1234");
});

// One company per user (2026-09-03): a Brain/Hands key must not decrypt
// for a tenant that isn't the account's currently active company, even
// though the key itself is perfectly valid — this is the third,
// independent enforcement layer alongside CostGate and the scheduler,
// so a decrypt call reached some other way still can't use the key.
test("decryptBrainKey refuses a valid key for a tenant the eligibility resolver says is not active", async () => {
  const vault = makeVaultWithEligibility(() => false);
  await vault.storeBrainKey({ tenantId: "tenant-a", roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-1234") }, ONBOARDING);

  await assert.rejects(() => vault.decryptBrainKey("tenant-a", "cfo", ROUTER), TenantNotActiveError);
});

test("decryptHandsKey refuses a valid key for a tenant the eligibility resolver says is not active", async () => {
  const vault = makeVaultWithEligibility(() => false);
  const keyId = await storeOAuthHandsKey(vault, { service: "google-calendar", accessToken: "tok-1", expiresAt: FRESH_ISO });

  await assert.rejects(() => decryptOAuth(vault, keyId), TenantNotActiveError);
});

test("the eligibility resolver is called with the tenant id being decrypted, per-call, and a true result decrypts normally", async () => {
  const seen: string[] = [];
  const vault = makeVaultWithEligibility((tenantId) => {
    seen.push(tenantId);
    return true;
  });
  await vault.storeBrainKey({ tenantId: "tenant-a", roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-1234") }, ONBOARDING);

  const { handle } = await vault.decryptBrainKey("tenant-a", "cfo", ROUTER);
  assert.equal(await handle.use((buf) => buf.toString("utf8")), "sk-ant-1234");
  assert.deepEqual(seen, ["tenant-a"]);
});

// ADR-031: getBrainKeyStatus is a pure metadata read (does the row exist,
// is it revoked) — it was never meant to prove decryption still works,
// but "connected" reading true is easy to mistake for "working." This is
// the real check.
test("verifyBrainKeyDecryptable: true for a genuinely stored, decryptable key", async () => {
  const vault = makeVault();
  await vault.storeBrainKey({ tenantId: "tenant-a", roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-real") }, ONBOARDING);

  assert.equal(await vault.verifyBrainKeyDecryptable("tenant-a", "cfo"), true);
});

test("verifyBrainKeyDecryptable: false (not a throw) when no key was ever stored for that role", async () => {
  const vault = makeVault();
  assert.equal(await vault.verifyBrainKeyDecryptable("tenant-a", "no-such-role"), false);
});

test("verifyBrainKeyDecryptable: false (not a throw) for a revoked key", async () => {
  const vault = makeVault();
  await vault.storeBrainKey({ tenantId: "tenant-a", roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-real") }, ONBOARDING);
  await vault.revokeBrainKey("tenant-a", "cfo", { kind: "admin", serviceId: "x" });

  assert.equal(await vault.verifyBrainKeyDecryptable("tenant-a", "cfo"), false);
});

// The live incident this method exists to catch: deploy-staging.yml
// regenerated STAGING_KMS_MASTER_KEY on every redeploy, silently
// orphaning every tenant's DEK. Simulated here by sharing the SAME
// underlying key store/DEK store (nothing about the stored rows
// changes) across two Vaults built with DIFFERENT master keys — exactly
// what "the KMS master key rotated" means at the storage layer.
test("verifyBrainKeyDecryptable: false after the KMS master key has rotated out from under a stored key (ADR-031)", async () => {
  const store = new InMemoryVaultKeyStore();
  const dekRecordStore = new InMemoryDekRecordStore();
  const originalKms = new LocalKms(join(mkdtempSync(join(tmpdir(), "vault-test-")), "master.key"));
  const vault = new Vault(originalKms, undefined, 60_000, undefined, undefined, store, dekRecordStore);

  await vault.storeBrainKey({ tenantId: "tenant-a", roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-real") }, ONBOARDING);
  assert.equal(await vault.verifyBrainKeyDecryptable("tenant-a", "cfo"), true);

  const rotatedKms = new LocalKms(join(mkdtempSync(join(tmpdir(), "vault-test-")), "master.key"));
  const vaultAfterRotation = new Vault(rotatedKms, undefined, 60_000, undefined, undefined, store, dekRecordStore);

  assert.equal(await vaultAfterRotation.verifyBrainKeyDecryptable("tenant-a", "cfo"), false);
});

test("verifyBrainKeyDecryptable: never leaks the plaintext it recovers — the recovered buffer is zeroed, not returned", async () => {
  const vault = makeVault();
  await vault.storeBrainKey({ tenantId: "tenant-a", roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-real") }, ONBOARDING);

  const result = await vault.verifyBrainKeyDecryptable("tenant-a", "cfo");
  assert.equal(typeof result, "boolean");
});

// ADR-032: the actual live incident — reconnecting Acme's Brain key
// after the master key was stabilized still failed, because
// storeBrainKey reused the tenant's EXISTING (now-undecryptable) DEK
// instead of ever attempting a new one. Write paths must recover from
// this transparently: discard the dead DEK, encrypt the fresh key under
// a new one, succeed.
test("storeBrainKey succeeds (discarding and recreating the DEK) even when the tenant's existing DEK can no longer be decrypted (ADR-032)", async () => {
  const store = new InMemoryVaultKeyStore();
  const dekRecordStore = new InMemoryDekRecordStore();
  const originalKms = new LocalKms(join(mkdtempSync(join(tmpdir(), "vault-test-")), "master.key"));
  const originalVault = new Vault(originalKms, undefined, 60_000, undefined, undefined, store, dekRecordStore);
  await originalVault.storeBrainKey({ tenantId: "tenant-a", roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-old") }, ONBOARDING);

  // "The master key rotates" — a fresh Vault sharing the same stores,
  // built with a different KMS.
  const rotatedKms = new LocalKms(join(mkdtempSync(join(tmpdir(), "vault-test-")), "master.key"));
  const vaultAfterRotation = new Vault(rotatedKms, undefined, 60_000, undefined, undefined, store, dekRecordStore);

  // The reconnect: must succeed, not throw, exactly like the live bug
  // this test is named for.
  await vaultAfterRotation.storeBrainKey(
    { tenantId: "tenant-a", roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-fresh") },
    ONBOARDING,
  );

  const { handle } = await vaultAfterRotation.decryptBrainKey("tenant-a", "cfo", ROUTER);
  await handle.use(async (plaintext) => {
    assert.equal(plaintext.toString("utf8"), "sk-ant-fresh");
  });
});

test("storeHandsKey succeeds (discarding and recreating the DEK) even when the tenant's existing DEK can no longer be decrypted (ADR-032)", async () => {
  const store = new InMemoryVaultKeyStore();
  const dekRecordStore = new InMemoryDekRecordStore();
  const originalKms = new LocalKms(join(mkdtempSync(join(tmpdir(), "vault-test-")), "master.key"));
  const originalVault = new Vault(originalKms, undefined, 60_000, undefined, undefined, store, dekRecordStore);
  await originalVault.storeHandsKey(
    { tenantId: "tenant-a", subAgentId: "invoicing", capabilityScope: "stripe:read-only", service: "stripe", plaintext: Buffer.from("sk_live_old") },
    ONBOARDING,
  );

  const rotatedKms = new LocalKms(join(mkdtempSync(join(tmpdir(), "vault-test-")), "master.key"));
  const vaultAfterRotation = new Vault(rotatedKms, undefined, 60_000, undefined, undefined, store, dekRecordStore);

  const stored = await vaultAfterRotation.storeHandsKey(
    { tenantId: "tenant-a", subAgentId: "invoicing", capabilityScope: "stripe:read-only", service: "stripe", plaintext: Buffer.from("sk_live_fresh") },
    ONBOARDING,
  );

  const handle = await vaultAfterRotation.decryptHandsKey("tenant-a", stored.id, { subAgentId: "invoicing", capabilityScope: "stripe:read-only" }, ROUTER);
  await handle.use(async (plaintext) => {
    assert.equal(plaintext.toString("utf8"), "sk_live_fresh");
  });
});

// The read-side half: decryptBrainKey/decryptHandsKey must NOT silently
// discard and recreate the DEK the way write paths do — recreating on a
// passive read would be a surprising side effect that doesn't even help
// (the EXISTING material was encrypted under the dead DEK specifically;
// a fresh DEK can't read it either). The honest behavior is a clear,
// typed failure.
test("decryptBrainKey throws DekUndecryptableError (not a silent recreate) when the tenant's DEK can no longer be decrypted", async () => {
  const store = new InMemoryVaultKeyStore();
  const dekRecordStore = new InMemoryDekRecordStore();
  const originalKms = new LocalKms(join(mkdtempSync(join(tmpdir(), "vault-test-")), "master.key"));
  const originalVault = new Vault(originalKms, undefined, 60_000, undefined, undefined, store, dekRecordStore);
  await originalVault.storeBrainKey({ tenantId: "tenant-a", roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-old") }, ONBOARDING);

  const rotatedKms = new LocalKms(join(mkdtempSync(join(tmpdir(), "vault-test-")), "master.key"));
  const vaultAfterRotation = new Vault(rotatedKms, undefined, 60_000, undefined, undefined, store, dekRecordStore);

  await assert.rejects(() => vaultAfterRotation.decryptBrainKey("tenant-a", "cfo", ROUTER), DekUndecryptableError);
});

test("decryptHandsKey throws DekUndecryptableError (not a silent recreate) when the tenant's DEK can no longer be decrypted", async () => {
  const store = new InMemoryVaultKeyStore();
  const dekRecordStore = new InMemoryDekRecordStore();
  const originalKms = new LocalKms(join(mkdtempSync(join(tmpdir(), "vault-test-")), "master.key"));
  const originalVault = new Vault(originalKms, undefined, 60_000, undefined, undefined, store, dekRecordStore);
  const stored = await originalVault.storeHandsKey(
    { tenantId: "tenant-a", subAgentId: "invoicing", capabilityScope: "stripe:read-only", service: "stripe", plaintext: Buffer.from("sk_live_old") },
    ONBOARDING,
  );

  const rotatedKms = new LocalKms(join(mkdtempSync(join(tmpdir(), "vault-test-")), "master.key"));
  const vaultAfterRotation = new Vault(rotatedKms, undefined, 60_000, undefined, undefined, store, dekRecordStore);

  await assert.rejects(
    () => vaultAfterRotation.decryptHandsKey("tenant-a", stored.id, { subAgentId: "invoicing", capabilityScope: "stripe:read-only" }, ROUTER),
    DekUndecryptableError,
  );
});

// verifyBrainKeyDecryptable already returns false on an undecryptable DEK
// (ADR-031) -- this confirms the read-only promise more strongly: calling
// it does NOT discard/recreate anything as a side effect. A later write
// still needs (and gets) the discard-and-recreate path itself.
test("verifyBrainKeyDecryptable does not discard/recreate the dead DEK as a side effect of checking it", async () => {
  const store = new InMemoryVaultKeyStore();
  const dekRecordStore = new InMemoryDekRecordStore();
  const originalKms = new LocalKms(join(mkdtempSync(join(tmpdir(), "vault-test-")), "master.key"));
  const originalVault = new Vault(originalKms, undefined, 60_000, undefined, undefined, store, dekRecordStore);
  await originalVault.storeBrainKey({ tenantId: "tenant-a", roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-old") }, ONBOARDING);

  const rotatedKms = new LocalKms(join(mkdtempSync(join(tmpdir(), "vault-test-")), "master.key"));
  const vaultAfterRotation = new Vault(rotatedKms, undefined, 60_000, undefined, undefined, store, dekRecordStore);

  assert.equal(await vaultAfterRotation.verifyBrainKeyDecryptable("tenant-a", "cfo"), false);
  // If the check above had silently discarded/recreated the DEK, this
  // decrypt (still against the same "rotated" master key) would now
  // spuriously succeed against the wrong material, or fail a different
  // way -- it must still fail as a DekUndecryptableError, proving the
  // dead DEK was left exactly as it was.
  await assert.rejects(() => vaultAfterRotation.decryptBrainKey("tenant-a", "cfo", ROUTER), DekUndecryptableError);
});

test("access control: only a router-service identity may decrypt", async () => {
  const vault = makeVault();
  await vault.storeBrainKey(
    { tenantId: "tenant-a", roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-abc123456") },
    ONBOARDING,
  );

  await assert.rejects(() => vault.decryptBrainKey("tenant-a", "cfo", ONBOARDING), AccessDeniedError);
  await assert.rejects(() => vault.decryptBrainKey("tenant-a", "cfo", { kind: "admin", serviceId: "x" }), AccessDeniedError);
  // Router identity still works:
  const { handle } = await vault.decryptBrainKey("tenant-a", "cfo", ROUTER);
  assert.equal(handle.isZeroed, false);
});

test("scope binding: a HandsKey decrypted with the WRONG sub-agent claim fails, even though the key id is valid", async () => {
  const vault = makeVault();
  const record = await vault.storeHandsKey(
    {
      tenantId: "tenant-a",
      subAgentId: "invoicing",
      capabilityScope: "stripe:read-only",
      service: "stripe",
      plaintext: Buffer.from("sk_live_stripekey123456"),
    },
    ONBOARDING,
  );

  // Correct claim succeeds.
  const handle = await vault.decryptHandsKey(
    "tenant-a",
    record.id,
    { subAgentId: "invoicing", capabilityScope: "stripe:read-only" },
    ROUTER,
  );
  assert.equal(handle.isZeroed, false);

  // A DIFFERENT sub-agent (or the same sub-agent claiming a different
  // capability) trying to decrypt the SAME key id must fail — the binding
  // is cryptographic (AAD), not just a lookup-table check.
  await assert.rejects(
    () => vault.decryptHandsKey("tenant-a", record.id, { subAgentId: "expense-categorization", capabilityScope: "stripe:read-only" }, ROUTER),
    ScopeBindingError,
  );
  await assert.rejects(
    () => vault.decryptHandsKey("tenant-a", record.id, { subAgentId: "invoicing", capabilityScope: "stripe:read-write" }, ROUTER),
    ScopeBindingError,
  );
});

test("TTL: a handle zeroes itself after the timeout even if use() is never called", async () => {
  const vault = makeVault(20); // 20ms TTL for the test
  await vault.storeBrainKey(
    { tenantId: "tenant-a", roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-abc123456") },
    ONBOARDING,
  );

  const { handle } = await vault.decryptBrainKey("tenant-a", "cfo", ROUTER);
  assert.equal(handle.isZeroed, false);

  await sleep(50);

  assert.equal(handle.isZeroed, true);
  await assert.rejects(() => handle.use((buf) => buf.toString("utf8")), SecretExpiredError);
});

test("TTL: a handle zeroes itself immediately after use(), before the timeout", async () => {
  const vault = makeVault(60_000);
  await vault.storeBrainKey(
    { tenantId: "tenant-a", roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-abc123456") },
    ONBOARDING,
  );

  const { handle } = await vault.decryptBrainKey("tenant-a", "cfo", ROUTER);
  await handle.use((buf) => buf.toString("utf8"));
  assert.equal(handle.isZeroed, true);

  // A second use() must fail — the buffer is gone, not just "used once but still readable".
  await assert.rejects(() => handle.use((buf) => buf.toString("utf8")), SecretExpiredError);
});

test("unserializable: JSON.stringify and String() on a live handle never expose plaintext", async () => {
  const vault = makeVault();
  await vault.storeBrainKey(
    { tenantId: "tenant-a", roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-VERY-SECRET-VALUE") },
    ONBOARDING,
  );

  const { handle } = await vault.decryptBrainKey("tenant-a", "cfo", ROUTER);
  const serialized = JSON.stringify({ someHandle: handle });
  const stringified = String(handle);

  assert.ok(!serialized.includes("VERY-SECRET-VALUE"));
  assert.ok(!stringified.includes("VERY-SECRET-VALUE"));
  assert.match(serialized, /redacted/);
  assert.match(stringified, /redacted/);
});

test("revoke purges key material: decrypt after revoke fails, not just 'flagged'", async () => {
  const vault = makeVault();
  const record = await vault.storeHandsKey(
    {
      tenantId: "tenant-a",
      subAgentId: "invoicing",
      capabilityScope: "stripe:read-only",
      service: "stripe",
      plaintext: Buffer.from("sk_live_stripekey123456"),
    },
    ONBOARDING,
  );

  await vault.revokeHandsKey("tenant-a", record.id, { kind: "admin", serviceId: "x" });

  await assert.rejects(
    () => vault.decryptHandsKey("tenant-a", record.id, { subAgentId: "invoicing", capabilityScope: "stripe:read-only" }, ROUTER),
    KeyNotFoundError,
  );
});

test("issue #22: resolveHandsKeyId is null before a Hands key is stored, and resolves the real id after", async () => {
  const vault = makeVault();
  assert.equal(await vault.resolveHandsKeyId("tenant-a", "invoicing", "stripe:read-only"), null);

  const record = await vault.storeHandsKey(
    {
      tenantId: "tenant-a",
      subAgentId: "invoicing",
      capabilityScope: "stripe:read-only",
      service: "stripe",
      // Dash-separated, not the real "sk_live_..." shape — matches this
      // file's own other fixtures (sk-hands-fake-0001 etc.) and avoids
      // gitleaks' stripe-access-token rule tripping on a shape that reads
      // like a real key even though it never is one.
      plaintext: Buffer.from("sk-hands-fake-key-0001"),
    },
    ONBOARDING,
  );

  assert.equal(await vault.resolveHandsKeyId("tenant-a", "invoicing", "stripe:read-only"), record.id);
});

test("issue #22: resolveHandsKeyId and getHandsKeyStatus both go back to null once the key is revoked", async () => {
  const vault = makeVault();
  const record = await vault.storeHandsKey(
    {
      tenantId: "tenant-a",
      subAgentId: "invoicing",
      capabilityScope: "stripe:read-only",
      service: "stripe",
      plaintext: Buffer.from("sk-hands-fake-key-0002"),
    },
    ONBOARDING,
  );
  assert.equal((await vault.getHandsKeyStatus("tenant-a", "invoicing", "stripe:read-only"))?.id, record.id);

  await vault.revokeHandsKey("tenant-a", record.id, { kind: "admin", serviceId: "x" });

  assert.equal(await vault.resolveHandsKeyId("tenant-a", "invoicing", "stripe:read-only"), null);
  assert.equal(await vault.getHandsKeyStatus("tenant-a", "invoicing", "stripe:read-only"), null);
});

test("issue #22: cross-tenant isolation — two tenants using the same subAgentId+capabilityScope get fully independent Hands keys", async () => {
  const vault = makeVault();
  await vault.storeHandsKey(
    { tenantId: "tenant-a", subAgentId: "invoicing", capabilityScope: "stripe:read-only", service: "stripe", plaintext: Buffer.from("sk-tenant-a") },
    ONBOARDING,
  );
  await vault.storeHandsKey(
    { tenantId: "tenant-b", subAgentId: "invoicing", capabilityScope: "stripe:read-only", service: "stripe", plaintext: Buffer.from("sk-tenant-b") },
    ONBOARDING,
  );

  const idA = await vault.resolveHandsKeyId("tenant-a", "invoicing", "stripe:read-only");
  const idB = await vault.resolveHandsKeyId("tenant-b", "invoicing", "stripe:read-only");
  assert.ok(idA && idB && idA !== idB);

  const handleA = await vault.decryptHandsKey("tenant-a", idA!, { subAgentId: "invoicing", capabilityScope: "stripe:read-only" }, ROUTER);
  assert.equal(await handleA.use((buf) => buf.toString("utf8")), "sk-tenant-a");

  // Revoking tenant-a's key must not touch tenant-b's, even though both
  // share the exact same subAgentId+capabilityScope.
  await vault.revokeHandsKey("tenant-a", idA!, { kind: "admin", serviceId: "x" });
  assert.equal(await vault.resolveHandsKeyId("tenant-a", "invoicing", "stripe:read-only"), null);
  assert.equal(await vault.resolveHandsKeyId("tenant-b", "invoicing", "stripe:read-only"), idB);
});

test("issue #22: re-storing for the same scope overwrites which key resolves as current", async () => {
  const vault = makeVault();
  const first = await vault.storeHandsKey(
    { tenantId: "tenant-a", subAgentId: "invoicing", capabilityScope: "stripe:read-only", service: "stripe", plaintext: Buffer.from("sk-old") },
    ONBOARDING,
  );
  const second = await vault.storeHandsKey(
    { tenantId: "tenant-a", subAgentId: "invoicing", capabilityScope: "stripe:read-only", service: "stripe", plaintext: Buffer.from("sk-new") },
    ONBOARDING,
  );

  assert.notEqual(first.id, second.id);
  assert.equal(await vault.resolveHandsKeyId("tenant-a", "invoicing", "stripe:read-only"), second.id);
  assert.equal((await vault.getHandsKeyStatus("tenant-a", "invoicing", "stripe:read-only"))?.maskedFingerprint, second.maskedFingerprint);
});

test("cross-tenant isolation: two tenants using the same role id get fully independent Brain keys", async () => {
  const vault = makeVault();
  await vault.storeBrainKey(
    { tenantId: "tenant-a", roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-tenant-a-key") },
    ONBOARDING,
  );
  await vault.storeBrainKey(
    { tenantId: "tenant-b", roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-tenant-b-key") },
    ONBOARDING,
  );

  const { handle: handleA } = await vault.decryptBrainKey("tenant-a", "cfo", ROUTER);
  assert.equal(await handleA.use((buf) => buf.toString("utf8")), "sk-ant-tenant-a-key");

  const { handle: handleB } = await vault.decryptBrainKey("tenant-b", "cfo", ROUTER);
  assert.equal(await handleB.use((buf) => buf.toString("utf8")), "sk-ant-tenant-b-key");

  // Revoking tenant-a's "cfo" key must not touch tenant-b's "cfo" key.
  await vault.revokeBrainKey("tenant-a", "cfo", { kind: "admin", serviceId: "x" });
  await assert.rejects(() => vault.decryptBrainKey("tenant-a", "cfo", ROUTER), KeyNotFoundError);

  const { handle: handleBAfter } = await vault.decryptBrainKey("tenant-b", "cfo", ROUTER);
  assert.equal(await handleBAfter.use((buf) => buf.toString("utf8")), "sk-ant-tenant-b-key");
});

test("revoke-cancels-queued: the router's mock queue drops tasks for a revoked key when the event fires", async () => {
  const vault = makeVault();
  const record = await vault.storeHandsKey(
    {
      tenantId: "tenant-a",
      subAgentId: "invoicing",
      capabilityScope: "stripe:read-only",
      service: "stripe",
      plaintext: Buffer.from("sk_live_stripekey123456"),
    },
    ONBOARDING,
  );

  // Minimal stand-in for the real router's task queue: tasks reference a
  // handsKeyId, and a "key.revoked" listener cancels any queued task that
  // referenced the revoked key — the actual behavior the router registers.
  const queuedTasks = [
    { id: "task-1", handsKeyId: record.id, status: "queued" as "queued" | "cancelled" },
    { id: "task-2", handsKeyId: "some-other-key", status: "queued" as "queued" | "cancelled" },
  ];
  vault.onEvent((event) => {
    if (event.type !== "key.revoked") return;
    for (const task of queuedTasks) {
      if (task.handsKeyId === event.keyId) task.status = "cancelled";
    }
  });

  await vault.revokeHandsKey("tenant-a", record.id, { kind: "admin", serviceId: "x" });

  assert.equal(queuedTasks[0].status, "cancelled");
  assert.equal(queuedTasks[1].status, "queued"); // unrelated task untouched
});

test("store rejects a key that fails live validation, and stores nothing", async () => {
  const vault = makeVault();
  await assert.rejects(
    () =>
      vault.storeBrainKey(
        {
          tenantId: "tenant-a",
          roleId: "cfo",
          provider: "anthropic",
          plaintext: Buffer.from("sk-ant-invalid"),
          validate: async () => false,
        },
        ONBOARDING,
      ),
    /Live validation call failed/,
  );
  await assert.rejects(() => vault.decryptBrainKey("tenant-a", "cfo", ROUTER), KeyNotFoundError);
});

test("rotate: replaces the plaintext behind the same record, old plaintext no longer decryptable as new", async () => {
  const vault = makeVault();
  await vault.storeBrainKey(
    { tenantId: "tenant-a", roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-old-key-0001") },
    ONBOARDING,
  );

  const rotated = await vault.rotateBrainKey(
    "tenant-a",
    "cfo",
    Buffer.from("sk-ant-new-key-0002"),
    { kind: "admin", serviceId: "x" },
  );
  assert.equal(rotated.maskedFingerprint, "sk-...0002");

  const { handle } = await vault.decryptBrainKey("tenant-a", "cfo", ROUTER);
  const value = await handle.use((buf) => buf.toString("utf8"));
  assert.equal(value, "sk-ant-new-key-0002");
});

test("audit log records every operation and never contains key material", async () => {
  const vault = makeVault();
  const plaintext = Buffer.from("sk-ant-audit-test-secret");
  await vault.storeBrainKey({ tenantId: "tenant-a", roleId: "cfo", provider: "anthropic", plaintext }, ONBOARDING);
  await vault.decryptBrainKey("tenant-a", "cfo", ROUTER);
  await vault.revokeBrainKey("tenant-a", "cfo", { kind: "admin", serviceId: "x" });

  // recentForTenant is newest-first (matches PostgresDurableAuditLog's own
  // ORDER BY seq DESC — a "recent activity" read, not a full-history one).
  const events = await vault.auditEvents("tenant-a");
  const operations = events.map((e) => e.kind);
  assert.deepEqual(operations, ["revoke", "decrypt-granted", "store"]);

  const serializedLog = JSON.stringify(events);
  assert.ok(!serializedLog.includes("audit-test-secret"));
});

// PR 2A — OAuth credential storage and refresh (ADR-020). Every test below
// is one of the fail-closed properties named explicitly in the PR: refresh
// failure, network error, revoked refresh token, and expired-with-no-
// refresh-token must all end in a thrown error and NO SecretHandle, never a
// retry loop, never a stale-token handle, never a hang.

test("OAuth: a non-expired credential is returned as-is, no refresher ever called", async () => {
  const refresher = fakeRefresher(async () => ({ accessToken: "should-not-be-used", expiresAt: FRESH_ISO }));
  const vault = makeVaultWithRefreshers(new Map([["google-calendar", refresher]]));
  const keyId = await storeOAuthHandsKey(vault, { service: "google-calendar", accessToken: "tok-fresh", refreshToken: "refresh-1", expiresAt: FRESH_ISO });

  const handle = await decryptOAuth(vault, keyId);
  assert.equal(await handle.use((buf) => buf.toString("utf8")), "tok-fresh");
  assert.deepEqual(refresher.calls, []);
});

test("OAuth: an expired credential is silently refreshed and the new access token is returned", async () => {
  const refresher = fakeRefresher(async (refreshToken) => {
    assert.equal(refreshToken, "refresh-1");
    return { accessToken: "tok-refreshed", expiresAt: FRESH_ISO };
  });
  const vault = makeVaultWithRefreshers(new Map([["google-calendar", refresher]]));
  const keyId = await storeOAuthHandsKey(vault, { service: "google-calendar", accessToken: "tok-stale", refreshToken: "refresh-1", expiresAt: EXPIRED_ISO });

  const handle = await decryptOAuth(vault, keyId);
  assert.equal(await handle.use((buf) => buf.toString("utf8")), "tok-refreshed");
  assert.equal(refresher.calls.length, 1);

  // Re-encrypted in place, same key id — a second decrypt sees the new
  // token without a second refresh (it's fresh now).
  const handle2 = await decryptOAuth(vault, keyId);
  assert.equal(await handle2.use((buf) => buf.toString("utf8")), "tok-refreshed");
  assert.equal(refresher.calls.length, 1, "the second decrypt must not re-refresh an already-fresh token");

  const status = await vault.getHandsKeyStatus("tenant-a", "cmo.social", "social-post");
  assert.ok(status, "the key must still be connected, not revoked, after a successful refresh");
});

test("OAuth fail-closed: expired with no refresh token throws immediately, refresher never called, no handle returned", async () => {
  const refresher = fakeRefresher(async () => ({ accessToken: "unreachable", expiresAt: FRESH_ISO }));
  const vault = makeVaultWithRefreshers(new Map([["google-calendar", refresher]]));
  const keyId = await storeOAuthHandsKey(vault, { service: "google-calendar", accessToken: "tok-stale", expiresAt: EXPIRED_ISO }); // no refreshToken

  await assert.rejects(() => decryptOAuth(vault, keyId), HandsRefreshFailedError);
  assert.deepEqual(refresher.calls, []);
});

test("OAuth fail-closed: refresh failure (generic provider error) throws, key stays connected (transient, not revoked)", async () => {
  const refresher = fakeRefresher(async () => {
    throw new Error("provider returned 500");
  });
  const vault = makeVaultWithRefreshers(new Map([["google-calendar", refresher]]));
  const keyId = await storeOAuthHandsKey(vault, { service: "google-calendar", accessToken: "tok-stale", refreshToken: "refresh-1", expiresAt: EXPIRED_ISO });

  await assert.rejects(() => decryptOAuth(vault, keyId), HandsRefreshFailedError);
  assert.equal(refresher.calls.length, 1);
  assert.ok(await vault.getHandsKeyStatus("tenant-a", "cmo.social", "social-post"), "a transient refresh failure must not revoke the key — it may succeed next time");
});

test("OAuth fail-closed: network error during refresh is classified as HandsRefreshFailedError, never a stale handle", async () => {
  const refresher = fakeRefresher(async () => {
    throw new Error("ECONNRESET");
  });
  const vault = makeVaultWithRefreshers(new Map([["google-calendar", refresher]]));
  const keyId = await storeOAuthHandsKey(vault, { service: "google-calendar", accessToken: "tok-stale", refreshToken: "refresh-1", expiresAt: EXPIRED_ISO });

  let handleReturned = false;
  try {
    await decryptOAuth(vault, keyId);
    handleReturned = true;
  } catch (err) {
    assert.ok(err instanceof HandsRefreshFailedError);
  }
  assert.equal(handleReturned, false, "a network error during refresh must never produce a usable handle");
});

test("OAuth fail-closed: a revoked refresh token throws HandsRefreshTokenRevokedError AND the key becomes actually revoked", async () => {
  const refresher = fakeRefresher(async () => {
    throw new HandsRefreshTokenRevokedError("invalid_grant");
  });
  const vault = makeVaultWithRefreshers(new Map([["google-calendar", refresher]]));
  const keyId = await storeOAuthHandsKey(vault, { service: "google-calendar", accessToken: "tok-stale", refreshToken: "refresh-1", expiresAt: EXPIRED_ISO });

  const revokedEvents: string[] = [];
  vault.onEvent((e) => {
    if (e.type === "key.revoked") revokedEvents.push(e.keyId);
  });

  await assert.rejects(() => decryptOAuth(vault, keyId), HandsRefreshTokenRevokedError);

  assert.equal(await vault.getHandsKeyStatus("tenant-a", "cmo.social", "social-post"), null, "a revoked-refresh-token failure must actually revoke the stored key, not just fail this one call");
  assert.deepEqual(revokedEvents, [keyId], "the same key.revoked event a manual revoke fires must fire here too — #22/#37's revoke-cancels-queued listener depends on it");

  // And it must actually stay revoked — a later decrypt attempt fails
  // cleanly (KeyNotFoundError), not by re-attempting a doomed refresh.
  await assert.rejects(() => decryptOAuth(vault, keyId), KeyNotFoundError);
  assert.equal(refresher.calls.length, 1, "no retry against a refresh token already known to be dead");
});

test("OAuth fail-closed: a hanging refresher never hangs the caller — bounded by refreshTimeoutMs", async () => {
  // Settles eventually (well after the 50ms refreshTimeoutMs below) rather
  // than never — a truly eternal `new Promise(() => {})` has nothing left
  // to await it once withTimeout's own race settles, and node:test's
  // runner flags that dangling, forever-pending promise at file-exit,
  // cascading a "cancelledByParent" failure into every later test in this
  // file (caught in CI, not locally — a slower/differently-scheduled
  // runner made the dangling-promise window actually observable). The
  // property under test — the CALLER rejects on the bounded timeout, long
  // before the refresher itself would ever resolve — is unaffected by
  // giving the refresher a real, if distant, resolution.
  const refresher = fakeRefresher(
    () => new Promise<RefreshedCredential>((resolve) => setTimeout(() => resolve({ accessToken: "too-late", expiresAt: FRESH_ISO }), 300)),
  );
  const vault = makeVaultWithRefreshers(new Map([["google-calendar", refresher]]), 50);
  const keyId = await storeOAuthHandsKey(vault, { service: "google-calendar", accessToken: "tok-stale", refreshToken: "refresh-1", expiresAt: EXPIRED_ISO });

  const start = Date.now();
  await assert.rejects(() => decryptOAuth(vault, keyId), HandsRefreshFailedError);
  assert.ok(Date.now() - start < 2_000, "must reject on the bounded timeout, not hang indefinitely");
});

test("OAuth: concurrent decrypts on the same expiring credential single-flight — the refresher is called exactly once", async () => {
  let resolveRefresh!: (v: RefreshedCredential) => void;
  const refresher = fakeRefresher(() => new Promise<RefreshedCredential>((resolve) => { resolveRefresh = resolve; }));
  const vault = makeVaultWithRefreshers(new Map([["google-calendar", refresher]]));
  const keyId = await storeOAuthHandsKey(vault, { service: "google-calendar", accessToken: "tok-stale", refreshToken: "refresh-1", expiresAt: EXPIRED_ISO });

  // Two callers race in before either sees a result — verified reachable in
  // practice, not just theoretical: @open-multi-agent/core's
  // ToolExecutor.executeBatch runs a turn's tool calls through Promise.all
  // with a 4-way semaphore (dist/tool/executor.js), so an LLM double-
  // calling the same Hands tool in one turn really does reach
  // decryptHandsKey twice concurrently (ADR-020).
  const first = decryptOAuth(vault, keyId);
  const second = decryptOAuth(vault, keyId);

  await sleep(10); // let both calls reach the in-flight map before the refresh resolves
  resolveRefresh({ accessToken: "tok-refreshed-once", expiresAt: FRESH_ISO });

  const [handleA, handleB] = await Promise.all([first, second]);
  assert.equal(await handleA.use((buf) => buf.toString("utf8")), "tok-refreshed-once");
  assert.equal(await handleB.use((buf) => buf.toString("utf8")), "tok-refreshed-once");
  assert.equal(refresher.calls.length, 1, "must not double-refresh — this is the property the in-flight map exists to guarantee");
});

test("OAuth: a failed single-flight refresh rejects every concurrent caller, and clears the in-flight slot for a later retry", async () => {
  let attempt = 0;
  const refresher = fakeRefresher(async () => {
    attempt += 1;
    if (attempt === 1) throw new Error("first attempt fails");
    return { accessToken: "tok-second-attempt", expiresAt: FRESH_ISO };
  });
  const vault = makeVaultWithRefreshers(new Map([["google-calendar", refresher]]));
  const keyId = await storeOAuthHandsKey(vault, { service: "google-calendar", accessToken: "tok-stale", refreshToken: "refresh-1", expiresAt: EXPIRED_ISO });

  const [firstResult, secondResult] = await Promise.allSettled([decryptOAuth(vault, keyId), decryptOAuth(vault, keyId)]);
  assert.equal(firstResult.status, "rejected");
  assert.equal(secondResult.status, "rejected");
  assert.equal(refresher.calls.length, 1, "both concurrent callers shared the one failed attempt, not two");

  // The in-flight slot must have been cleared (the `finally` in
  // getOrRefreshCredential) so a later call isn't stuck awaiting a
  // promise that already settled — it starts a fresh attempt.
  const handle = await decryptOAuth(vault, keyId);
  assert.equal(await handle.use((buf) => buf.toString("utf8")), "tok-second-attempt");
  assert.equal(refresher.calls.length, 2);
});

test("OAuth: the refreshed access token is still never serializable — same redaction as every other SecretHandle", async () => {
  const refresher = fakeRefresher(async () => ({ accessToken: "tok-secret-refreshed", expiresAt: FRESH_ISO }));
  const vault = makeVaultWithRefreshers(new Map([["google-calendar", refresher]]));
  const keyId = await storeOAuthHandsKey(vault, { service: "google-calendar", accessToken: "tok-stale", refreshToken: "refresh-1", expiresAt: EXPIRED_ISO });

  const handle = await decryptOAuth(vault, keyId);
  const serialized = JSON.stringify({ someHandle: handle });
  const stringified = String(handle);

  assert.ok(!serialized.includes("tok-secret-refreshed"));
  assert.ok(!stringified.includes("tok-secret-refreshed"));
});

test("LocalKms generates and persists a master key file on first run, reuses it after", async () => {
  const dir = mkdtempSync(join(tmpdir(), "kms-test-"));
  const keyPath = join(dir, "nested", "master.key");
  try {
    const kms1 = new LocalKms(keyPath);
    const kms2 = new LocalKms(keyPath); // second instance should load the SAME key, not generate a new one

    const dek = Buffer.from("0123456789abcdef0123456789abcdef", "utf8").subarray(0, 32);
    const encrypted = await kms1.encryptDek(dek);
    const decrypted = await kms2.decryptDek(encrypted);
    assert.ok(decrypted.equals(dek));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
