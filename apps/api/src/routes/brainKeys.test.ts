import assert from "node:assert/strict";
import { Hono } from "hono";
import { test } from "node:test";
import type { OrgChart } from "@byok/contracts";
import { ValidationFailedError, type PublicKeyRecord } from "@byok/vault";
import type { AppEnv, AppSession } from "../context.js";
import { brainKeyRoute, DEFAULT_BRAIN_ROLE_ID, type BrainKeyRouteDeps } from "./brainKeys.js";

function appWithSession(tenantId: string, session: AppSession, deps: BrainKeyRouteDeps) {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("tenantId", tenantId);
      c.set("session", session as NonNullable<AppSession>);
      await next();
    })
    .route("/", brainKeyRoute(deps));
}

function fakeOrgChart(teamIds: string[]): OrgChart {
  return {
    meta: {
      idea: "x",
      generatedAt: "2026-01-01T00:00:00.000Z",
      templateSelection: { primary: "generic" as never, blendedWith: null, scores: {} as never, tie: false },
      calls: [],
      costUsd: 0,
    },
    teams: teamIds.map((id) => ({ id: id as never, roleTitle: id, isHuman: false, agentIds: [] })),
    agents: [],
    tasks: [],
    customization: { added: [], removed: [], frequencyAdjustments: [], categoryCorrections: [] },
    onboardingBatch: null,
  };
}

function fakeDeps(overrides: Partial<BrainKeyRouteDeps> = {}): BrainKeyRouteDeps {
  return {
    vault: {
      storeBrainKey: async () => {
        throw new Error("unused in this test");
      },
      getBrainKeyStatus: () => {
        throw new Error("unused in this test");
      },
    },
    batchStore: {
      latestForTenant: async () => null,
    },
    ...overrides,
  };
}

const SESSION = { user: { id: "user-1", email: "cfo@example.com" }, session: {} } as never;

test("GET checks status under DEFAULT_BRAIN_ROLE_ID when no org chart is claimed yet", async () => {
  let seenArgs: [string, string] | undefined;
  const app = appWithSession(
    "tenant-1",
    SESSION,
    fakeDeps({
      vault: {
        storeBrainKey: async () => {
          throw new Error("unused");
        },
        getBrainKeyStatus: (tenantId, roleId) => {
          seenArgs = [tenantId, roleId];
          return null;
        },
      },
    }),
  );

  const res = await app.request("/");
  assert.equal(res.status, 200);
  assert.deepEqual(seenArgs, ["tenant-1", DEFAULT_BRAIN_ROLE_ID]);
  assert.deepEqual(await res.json(), { connected: false, key: null });
});

test("GET checks status under the org chart's first team id once a chart is claimed", async () => {
  let seenArgs: [string, string] | undefined;
  const status: PublicKeyRecord = {
    id: "key-1",
    tenantId: "tenant-1",
    type: "brain",
    roleId: "cfo",
    provider: "anthropic",
    maskedFingerprint: "sk-...4f2a",
    revoked: false,
    createdAt: "",
    updatedAt: "",
  };
  const app = appWithSession(
    "tenant-1",
    SESSION,
    fakeDeps({
      vault: {
        storeBrainKey: async () => {
          throw new Error("unused");
        },
        getBrainKeyStatus: (tenantId, roleId) => {
          seenArgs = [tenantId, roleId];
          return status;
        },
      },
      batchStore: {
        latestForTenant: async () => ({
          id: "batch-1",
          userId: "user-1",
          tenantId: "tenant-1",
          idea: "x",
          status: "completed",
          orgChart: fakeOrgChart(["cfo", "sales"]),
          costUsd: 0.01,
          error: null,
          createdAt: "",
          updatedAt: "",
        }),
      },
    }),
  );

  const res = await app.request("/");
  assert.equal(res.status, 200);
  assert.deepEqual(seenArgs, ["tenant-1", "cfo"]);
  assert.deepEqual(await res.json(), { connected: true, key: status });
});

test("POST rejects a body missing provider/apiKey with 400 before ever calling the vault", async () => {
  const app = appWithSession("tenant-1", SESSION, fakeDeps());
  const res = await app.request("/", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({}) });
  assert.equal(res.status, 400);
});

test("POST stores the key under every team id in the claimed org chart, validating only once", async () => {
  // Deliberately does NOT invoke input.validate here — that closure calls
  // the real provider (validateBrainKey), which would make a genuine
  // network call in a unit test. Only whether it's WIRED (present on the
  // first role, absent after) is this route's own contract to prove;
  // validateBrainKey's own behavior is providerValidation.test.ts's job.
  const rolesWithValidate: string[] = [];
  const storedRoleIds: string[] = [];
  const app = appWithSession(
    "tenant-1",
    SESSION,
    fakeDeps({
      vault: {
        storeBrainKey: async (input, requester) => {
          storedRoleIds.push(input.roleId);
          if (input.validate) rolesWithValidate.push(input.roleId);
          assert.deepEqual(requester, { kind: "tenant-user", userId: "user-1" });
          return {
            id: `key-${input.roleId}`,
            tenantId: input.tenantId,
            type: "brain",
            roleId: input.roleId,
            provider: input.provider,
            maskedFingerprint: "sk-...abcd",
            revoked: false,
            createdAt: "",
            updatedAt: "",
          } satisfies PublicKeyRecord;
        },
        getBrainKeyStatus: () => {
          throw new Error("unused");
        },
      },
      batchStore: {
        latestForTenant: async () => ({
          id: "batch-1",
          userId: "user-1",
          tenantId: "tenant-1",
          idea: "x",
          status: "completed",
          orgChart: fakeOrgChart(["cfo", "sales"]),
          costUsd: 0.01,
          error: null,
          createdAt: "",
          updatedAt: "",
        }),
      },
    }),
  );

  const res = await app.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "anthropic", apiKey: "sk-ant-real-key" }),
  });

  assert.equal(res.status, 201);
  assert.deepEqual(storedRoleIds, ["cfo", "sales"]);
  assert.deepEqual(rolesWithValidate, ["cfo"]);
});

test("POST returns 422 (not a 500) when live validation rejects the key, and stores nothing", async () => {
  let storeCalls = 0;
  const app = appWithSession(
    "tenant-1",
    SESSION,
    fakeDeps({
      vault: {
        // Mirrors what Vault.storeBrainKey itself does when its
        // `validate` hook returns false — this test is about the route's
        // ValidationFailedError -> 422 mapping, not Vault's own internal
        // wiring (covered by packages/vault's own tests).
        storeBrainKey: async () => {
          storeCalls += 1;
          throw new ValidationFailedError("Live validation call failed — key was not stored.");
        },
        getBrainKeyStatus: () => {
          throw new Error("unused");
        },
      },
    }),
  );

  const res = await app.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ provider: "anthropic", apiKey: "sk-ant-bad-key" }),
  });

  assert.equal(res.status, 422);
  assert.equal(storeCalls, 1);
});
