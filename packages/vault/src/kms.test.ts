import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LocalKms, ProductionKmsGuardError } from "./kms.js";

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
