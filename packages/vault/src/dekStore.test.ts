import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DekStore, DekUndecryptableError } from "./dekStore.js";
import { InMemoryDekRecordStore } from "./durable/dekRecordStore.js";
import { LocalKms } from "./kms.js";

function makeKms(): LocalKms {
  return new LocalKms(join(mkdtempSync(join(tmpdir(), "dekstore-test-")), "master.key"));
}

test("getOrCreateDek creates a fresh DEK when none exists yet, and reuses it on the next call", async () => {
  const store = new InMemoryDekRecordStore();
  const dekStore = new DekStore(makeKms(), store);

  const first = await dekStore.getOrCreateDek("tenant-a");
  const second = await dekStore.getOrCreateDek("tenant-a");

  assert.deepEqual(first, second);
});

test("getOrCreateDek isolates DEKs per tenant", async () => {
  const store = new InMemoryDekRecordStore();
  const dekStore = new DekStore(makeKms(), store);

  const a = await dekStore.getOrCreateDek("tenant-a");
  const b = await dekStore.getOrCreateDek("tenant-b");

  assert.notDeepEqual(a, b);
});

// ADR-032: the live incident this exists to catch — a tenant's stored
// DEK was encrypted under a KMS master key that has since been rotated
// away (deploy-staging.yml regenerating STAGING_KMS_MASTER_KEY on every
// deploy, before ADR-031's fix). Simulated here exactly as it happens at
// the storage layer: two DekStores share the same underlying record
// store but are built with two DIFFERENT master keys.
test("getOrCreateDek throws DekUndecryptableError (never a raw crypto exception) when the existing DEK can't be decrypted under the current master key", async () => {
  const store = new InMemoryDekRecordStore();
  const originalDekStore = new DekStore(makeKms(), store);
  await originalDekStore.getOrCreateDek("tenant-a"); // creates and persists a DEK under the original key

  const rotatedDekStore = new DekStore(makeKms(), store); // different master key, same store
  await assert.rejects(() => rotatedDekStore.getOrCreateDek("tenant-a"), DekUndecryptableError);
});

test("discardAndRecreateDek replaces an undecryptable DEK, and getOrCreateDek succeeds afterward", async () => {
  const store = new InMemoryDekRecordStore();
  const originalDekStore = new DekStore(makeKms(), store);
  await originalDekStore.getOrCreateDek("tenant-a");

  const rotatedDekStore = new DekStore(makeKms(), store);
  await assert.rejects(() => rotatedDekStore.getOrCreateDek("tenant-a"), DekUndecryptableError);

  const fresh = await rotatedDekStore.discardAndRecreateDek("tenant-a");
  assert.ok(Buffer.isBuffer(fresh) && fresh.length === 32);

  // The fresh DEK is now genuinely on file — a later call on the SAME
  // (now-current) master key reads it back cleanly, no error.
  const reread = await rotatedDekStore.getOrCreateDek("tenant-a");
  assert.deepEqual(reread, fresh);
});

test("discardAndRecreateDek's replacement is genuinely a different DEK, not the old one somehow recovered", async () => {
  const store = new InMemoryDekRecordStore();
  const kmsA = makeKms();
  const originalDekStore = new DekStore(kmsA, store);
  const originalDek = await originalDekStore.getOrCreateDek("tenant-a");

  const rotatedDekStore = new DekStore(makeKms(), store);
  const fresh = await rotatedDekStore.discardAndRecreateDek("tenant-a");

  assert.notDeepEqual(fresh, originalDek);

  // And the OLD master key can no longer read what's on file now either
  // -- the old DEK is truly gone, not just shadowed.
  const backWithOldKms = new DekStore(kmsA, store);
  await assert.rejects(() => backWithOldKms.getOrCreateDek("tenant-a"), DekUndecryptableError);
});
