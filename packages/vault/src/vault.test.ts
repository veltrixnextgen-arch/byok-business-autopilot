import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { Vault } from "./vault.js";
import { LocalKms } from "./kms.js";
import { AccessDeniedError, KeyNotFoundError, ScopeBindingError, SecretExpiredError } from "./types.js";
import type { RequesterIdentity } from "./types.js";

const ROUTER: RequesterIdentity = { kind: "router-service", serviceId: "router-1" };
const ONBOARDING: RequesterIdentity = { kind: "onboarding-service", serviceId: "onboarding-1" };

function makeVault(ttlMs = 60_000): Vault {
  const dir = mkdtempSync(join(tmpdir(), "vault-test-"));
  const kms = new LocalKms(join(dir, "master.key"));
  return new Vault(kms, undefined, ttlMs);
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

  const handle = await vault.decryptBrainKey("tenant-a", "cfo", ROUTER);
  const recovered = await handle.use((buf) => buf.toString("utf8"));
  assert.equal(recovered, "sk-ant-super-secret-1234");
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
  const handle = await vault.decryptBrainKey("tenant-a", "cfo", ROUTER);
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
    record.id,
    { subAgentId: "invoicing", capabilityScope: "stripe:read-only" },
    ROUTER,
  );
  assert.equal(handle.isZeroed, false);

  // A DIFFERENT sub-agent (or the same sub-agent claiming a different
  // capability) trying to decrypt the SAME key id must fail — the binding
  // is cryptographic (AAD), not just a lookup-table check.
  await assert.rejects(
    () => vault.decryptHandsKey(record.id, { subAgentId: "expense-categorization", capabilityScope: "stripe:read-only" }, ROUTER),
    ScopeBindingError,
  );
  await assert.rejects(
    () => vault.decryptHandsKey(record.id, { subAgentId: "invoicing", capabilityScope: "stripe:read-write" }, ROUTER),
    ScopeBindingError,
  );
});

test("TTL: a handle zeroes itself after the timeout even if use() is never called", async () => {
  const vault = makeVault(20); // 20ms TTL for the test
  await vault.storeBrainKey(
    { tenantId: "tenant-a", roleId: "cfo", provider: "anthropic", plaintext: Buffer.from("sk-ant-abc123456") },
    ONBOARDING,
  );

  const handle = await vault.decryptBrainKey("tenant-a", "cfo", ROUTER);
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

  const handle = await vault.decryptBrainKey("tenant-a", "cfo", ROUTER);
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

  const handle = await vault.decryptBrainKey("tenant-a", "cfo", ROUTER);
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

  await vault.revokeHandsKey(record.id, { kind: "admin", serviceId: "x" });

  await assert.rejects(
    () => vault.decryptHandsKey(record.id, { subAgentId: "invoicing", capabilityScope: "stripe:read-only" }, ROUTER),
    KeyNotFoundError,
  );
});

test("issue #22: resolveHandsKeyId is null before a Hands key is stored, and resolves the real id after", async () => {
  const vault = makeVault();
  assert.equal(vault.resolveHandsKeyId("tenant-a", "invoicing", "stripe:read-only"), null);

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

  assert.equal(vault.resolveHandsKeyId("tenant-a", "invoicing", "stripe:read-only"), record.id);
});

test("issue #22: resolveHandsKeyId and getHandsKeyStatus both go back to null once the key is revoked", async () => {
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
  assert.equal(vault.getHandsKeyStatus("tenant-a", "invoicing", "stripe:read-only")?.id, record.id);

  await vault.revokeHandsKey(record.id, { kind: "admin", serviceId: "x" });

  assert.equal(vault.resolveHandsKeyId("tenant-a", "invoicing", "stripe:read-only"), null);
  assert.equal(vault.getHandsKeyStatus("tenant-a", "invoicing", "stripe:read-only"), null);
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

  const idA = vault.resolveHandsKeyId("tenant-a", "invoicing", "stripe:read-only");
  const idB = vault.resolveHandsKeyId("tenant-b", "invoicing", "stripe:read-only");
  assert.ok(idA && idB && idA !== idB);

  const handleA = await vault.decryptHandsKey(idA!, { subAgentId: "invoicing", capabilityScope: "stripe:read-only" }, ROUTER);
  assert.equal(await handleA.use((buf) => buf.toString("utf8")), "sk-tenant-a");

  // Revoking tenant-a's key must not touch tenant-b's, even though both
  // share the exact same subAgentId+capabilityScope.
  await vault.revokeHandsKey(idA!, { kind: "admin", serviceId: "x" });
  assert.equal(vault.resolveHandsKeyId("tenant-a", "invoicing", "stripe:read-only"), null);
  assert.equal(vault.resolveHandsKeyId("tenant-b", "invoicing", "stripe:read-only"), idB);
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
  assert.equal(vault.resolveHandsKeyId("tenant-a", "invoicing", "stripe:read-only"), second.id);
  assert.equal(vault.getHandsKeyStatus("tenant-a", "invoicing", "stripe:read-only")?.maskedFingerprint, second.maskedFingerprint);
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

  const handleA = await vault.decryptBrainKey("tenant-a", "cfo", ROUTER);
  assert.equal(await handleA.use((buf) => buf.toString("utf8")), "sk-ant-tenant-a-key");

  const handleB = await vault.decryptBrainKey("tenant-b", "cfo", ROUTER);
  assert.equal(await handleB.use((buf) => buf.toString("utf8")), "sk-ant-tenant-b-key");

  // Revoking tenant-a's "cfo" key must not touch tenant-b's "cfo" key.
  await vault.revokeBrainKey("tenant-a", "cfo", { kind: "admin", serviceId: "x" });
  await assert.rejects(() => vault.decryptBrainKey("tenant-a", "cfo", ROUTER), KeyNotFoundError);

  const handleBAfter = await vault.decryptBrainKey("tenant-b", "cfo", ROUTER);
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

  await vault.revokeHandsKey(record.id, { kind: "admin", serviceId: "x" });

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

  const handle = await vault.decryptBrainKey("tenant-a", "cfo", ROUTER);
  const value = await handle.use((buf) => buf.toString("utf8"));
  assert.equal(value, "sk-ant-new-key-0002");
});

test("audit log records every operation and never contains key material", async () => {
  const vault = makeVault();
  const plaintext = Buffer.from("sk-ant-audit-test-secret");
  await vault.storeBrainKey({ tenantId: "tenant-a", roleId: "cfo", provider: "anthropic", plaintext }, ONBOARDING);
  await vault.decryptBrainKey("tenant-a", "cfo", ROUTER);
  await vault.revokeBrainKey("tenant-a", "cfo", { kind: "admin", serviceId: "x" });

  const events = vault.auditEvents();
  const operations = events.map((e) => e.operation);
  assert.deepEqual(operations, ["store", "decrypt-granted", "revoke"]);

  const serializedLog = JSON.stringify(events);
  assert.ok(!serializedLog.includes("audit-test-secret"));
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
