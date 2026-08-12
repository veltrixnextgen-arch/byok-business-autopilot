import assert from "node:assert/strict";
import { Hono } from "hono";
import { test } from "node:test";
import type { PublicKeyRecord } from "@byok/vault";
import type { AppEnv, AppSession } from "../context.js";
import { handsKeyRoute, type HandsKeyRouteDeps } from "./handsKeys.js";

function appWithSession(tenantId: string, session: AppSession, deps: HandsKeyRouteDeps) {
  return new Hono<AppEnv>()
    .use("*", async (c, next) => {
      c.set("tenantId", tenantId);
      c.set("session", session as NonNullable<AppSession>);
      await next();
    })
    .route("/", handsKeyRoute(deps));
}

function fakeDeps(overrides: Partial<HandsKeyRouteDeps["vault"]> = {}): HandsKeyRouteDeps {
  return {
    vault: {
      storeHandsKey: async () => {
        throw new Error("unused in this test");
      },
      getHandsKeyStatus: () => {
        throw new Error("unused in this test");
      },
      ...overrides,
    },
  };
}

const SESSION = { user: { id: "user-1", email: "cfo@example.com" }, session: {} } as never;

test("GET status reads by the session's tenantId plus the requested subAgentId/capabilityScope", async () => {
  let seenArgs: [string, string, string] | undefined;
  const app = appWithSession(
    "tenant-1",
    SESSION,
    fakeDeps({
      getHandsKeyStatus: (tenantId, subAgentId, capabilityScope) => {
        seenArgs = [tenantId, subAgentId, capabilityScope];
        return null;
      },
    }),
  );

  const res = await app.request("/?subAgentId=invoicing&capabilityScope=stripe:read-only");
  assert.equal(res.status, 200);
  assert.deepEqual(seenArgs, ["tenant-1", "invoicing", "stripe:read-only"]);
  assert.deepEqual(await res.json(), { connected: false, key: null });
});

test("GET status reports connected: true with the key's public status once one exists", async () => {
  const status: PublicKeyRecord = {
    id: "key-1",
    tenantId: "tenant-1",
    type: "hands",
    subAgentId: "invoicing",
    capabilityScope: "stripe:read-only",
    service: "stripe",
    maskedFingerprint: "sk-...abcd",
    revoked: false,
    credentialKind: "opaque",
    createdAt: "",
    updatedAt: "",
  };
  const app = appWithSession("tenant-1", SESSION, fakeDeps({ getHandsKeyStatus: () => status }));

  const res = await app.request("/?subAgentId=invoicing&capabilityScope=stripe:read-only");
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { connected: true, key: status });
});

test("GET rejects a request missing subAgentId/capabilityScope with 400 before ever calling the vault", async () => {
  const app = appWithSession("tenant-1", SESSION, fakeDeps());
  const res = await app.request("/?subAgentId=invoicing");
  assert.equal(res.status, 400);
});

test("POST stores the key against the session's tenantId and a tenant-user requester, not anything client-supplied", async () => {
  let seenInput: unknown;
  let seenRequester: unknown;
  const app = appWithSession(
    "tenant-1",
    SESSION,
    fakeDeps({
      storeHandsKey: async (input, requester) => {
        seenInput = { ...input, plaintext: input.plaintext.toString("utf8") };
        seenRequester = requester;
        return {
          id: "key-1",
          tenantId: input.tenantId,
          type: "hands",
          subAgentId: input.subAgentId,
          capabilityScope: input.capabilityScope,
          service: input.service,
          maskedFingerprint: "sk-...abcd",
          revoked: false,
          credentialKind: "opaque",
          createdAt: "",
          updatedAt: "",
        } satisfies PublicKeyRecord;
      },
    }),
  );

  const res = await app.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      subAgentId: "invoicing",
      capabilityScope: "stripe:read-only",
      service: "stripe",
      apiKey: "sk_live_realkey",
      tenantId: "some-other-tenant",
    }),
  });

  assert.equal(res.status, 201);
  assert.deepEqual(seenInput, {
    tenantId: "tenant-1",
    subAgentId: "invoicing",
    capabilityScope: "stripe:read-only",
    service: "stripe",
    plaintext: "sk_live_realkey",
  });
  assert.deepEqual(seenRequester, { kind: "tenant-user", userId: "user-1" });
});

test("POST rejects a body missing required fields with 400 before ever calling the vault", async () => {
  const app = appWithSession("tenant-1", SESSION, fakeDeps());
  const res = await app.request("/", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ subAgentId: "invoicing" }),
  });
  assert.equal(res.status, 400);
});
