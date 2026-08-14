import { test } from "node:test";
import assert from "node:assert/strict";
import { isDevOrTestEnvironment } from "./env.js";

function withNodeEnv(value: string | undefined, run: () => void): void {
  const original = process.env.NODE_ENV;
  try {
    if (value === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = value;
    run();
  } finally {
    if (original === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = original;
  }
}

test("isDevOrTestEnvironment is true when NODE_ENV is unset, 'development', or 'test'", () => {
  withNodeEnv(undefined, () => assert.equal(isDevOrTestEnvironment(), true));
  withNodeEnv("development", () => assert.equal(isDevOrTestEnvironment(), true));
  withNodeEnv("test", () => assert.equal(isDevOrTestEnvironment(), true));
});

test("isDevOrTestEnvironment is false for staging, production, or anything else — allowlist, not a denylist", () => {
  withNodeEnv("staging", () => assert.equal(isDevOrTestEnvironment(), false));
  withNodeEnv("production", () => assert.equal(isDevOrTestEnvironment(), false));
  withNodeEnv("some-future-deploy-target", () => assert.equal(isDevOrTestEnvironment(), false));
});
