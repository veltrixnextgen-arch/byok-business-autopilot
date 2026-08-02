import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { LocalKms, ProductionKmsGuardError, StagingKms } from "./kms.js";

test("ADR-007: LocalKms refuses to construct when NODE_ENV=production", () => {
  const dir = mkdtempSync(join(tmpdir(), "kms-guard-test-"));
  const original = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.throws(() => new LocalKms(join(dir, "master.key")), ProductionKmsGuardError);
  } finally {
    process.env.NODE_ENV = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ADR-007: LocalKms refuses to construct when PRODUCTION=true even without NODE_ENV set", () => {
  const dir = mkdtempSync(join(tmpdir(), "kms-guard-test-"));
  const originalNodeEnv = process.env.NODE_ENV;
  const originalProduction = process.env.PRODUCTION;
  try {
    delete process.env.NODE_ENV;
    process.env.PRODUCTION = "true";
    assert.throws(() => new LocalKms(join(dir, "master.key")), ProductionKmsGuardError);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalProduction === undefined) delete process.env.PRODUCTION;
    else process.env.PRODUCTION = originalProduction;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("LocalKms still works normally outside production", () => {
  const dir = mkdtempSync(join(tmpdir(), "kms-guard-test-"));
  const original = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "test";
    assert.doesNotThrow(() => new LocalKms(join(dir, "master.key")));
  } finally {
    process.env.NODE_ENV = original;
    rmSync(dir, { recursive: true, force: true });
  }
});

test("ADR-007: StagingKms refuses to construct when NODE_ENV=production", () => {
  const original = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "production";
    assert.throws(() => new StagingKms(randomBytes(32).toString("base64")), ProductionKmsGuardError);
  } finally {
    process.env.NODE_ENV = original;
  }
});

test("ADR-007: StagingKms refuses to construct when PRODUCTION=true even without NODE_ENV set", () => {
  const originalNodeEnv = process.env.NODE_ENV;
  const originalProduction = process.env.PRODUCTION;
  try {
    delete process.env.NODE_ENV;
    process.env.PRODUCTION = "true";
    assert.throws(() => new StagingKms(randomBytes(32).toString("base64")), ProductionKmsGuardError);
  } finally {
    if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = originalNodeEnv;
    if (originalProduction === undefined) delete process.env.PRODUCTION;
    else process.env.PRODUCTION = originalProduction;
  }
});

test("StagingKms rejects a master key that doesn't decode to 32 bytes", () => {
  const original = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "test";
    assert.throws(() => new StagingKms(randomBytes(16).toString("base64")), /32 bytes/);
  } finally {
    process.env.NODE_ENV = original;
  }
});

test("StagingKms encrypts and decrypts a DEK outside production", async () => {
  const original = process.env.NODE_ENV;
  try {
    process.env.NODE_ENV = "test";
    const kms = new StagingKms(randomBytes(32).toString("base64"));
    const dek = randomBytes(32);
    const blob = await kms.encryptDek(dek);
    const decrypted = await kms.decryptDek(blob);
    assert.deepStrictEqual(decrypted, dek);
  } finally {
    process.env.NODE_ENV = original;
  }
});
