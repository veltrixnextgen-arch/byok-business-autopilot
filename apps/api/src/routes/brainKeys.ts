import { zValidator } from "@hono/zod-validator";
import type { SignupExtractionBatchStore } from "@byok/db";
import type { RequesterIdentity, Vault } from "@byok/vault";
import { ValidationFailedError } from "@byok/vault";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";
import { BRAIN_PROVIDERS, validateBrainKey, type BrainProvider } from "../brainKeys/providerValidation.js";

/** Sentinel role id used before an org chart is claimed, or if extraction
 *  never ran — the connect flow (issue #15) needs somewhere to store a key
 *  from the moment a tenant exists, not just after Charter acceptance
 *  (#16) produces real team ids. Once a chart IS claimed, every one of its
 *  team ids is used instead (matching OpenMultiAgentExecutor's real
 *  lookup key, task.teamId) — this is the v1 "one provider for the whole
 *  company" framing described in roles-and-api-key-guide.md's fallback
 *  case, not the full per-role picker (issue #13), which doesn't exist
 *  yet: Agent.brain is always null in the current data model. */
export const DEFAULT_BRAIN_ROLE_ID = "default";

export interface BrainKeyRouteDeps {
  vault: Pick<Vault, "storeBrainKey" | "getBrainKeyStatus" | "verifyBrainKeyDecryptable">;
  batchStore: Pick<SignupExtractionBatchStore, "latestForTenant">;
}

const connectSchema = z.object({
  provider: z.enum(BRAIN_PROVIDERS as [BrainProvider, ...BrainProvider[]]),
  apiKey: z.string().min(1),
});

async function roleIdsForTenant(deps: BrainKeyRouteDeps, tenantId: string): Promise<string[]> {
  const batch = await deps.batchStore.latestForTenant(tenantId);
  const teamIds = batch?.orgChart?.teams.map((team) => team.id) ?? [];
  return teamIds.length > 0 ? teamIds : [DEFAULT_BRAIN_ROLE_ID];
}

async function statusForRole(deps: BrainKeyRouteDeps, tenantId: string, roleId: string) {
  const status = await deps.vault.getBrainKeyStatus(tenantId, roleId);
  // ADR-031: `connected` (a key row exists, not revoked) and
  // `decryptable` (that row's material can actually be recovered right
  // now) are deliberately separate facts — connected-but-not-decryptable
  // (a rotated KMS master key, most likely) is a real, distinct state the
  // UI should be able to show differently than either "connected and
  // working" or "never connected." Skipped entirely when there's no row
  // at all — there is nothing to check decryptability of.
  const decryptable = status !== null ? await deps.vault.verifyBrainKeyDecryptable(tenantId, roleId) : null;
  return { connected: status !== null, decryptable, key: status };
}

async function storeForRoles(
  deps: BrainKeyRouteDeps,
  tenantId: string,
  requester: RequesterIdentity,
  provider: BrainProvider,
  plaintext: Buffer,
  roleIds: string[],
) {
  let stored;
  for (const [index, roleId] of roleIds.entries()) {
    stored = await deps.vault.storeBrainKey(
      {
        tenantId,
        roleId,
        provider,
        plaintext,
        // One real provider call per batch, not one per role — same key,
        // same provider, re-validating per role would just be N
        // redundant calls to the same endpoint.
        validate: index === 0 ? (pt) => validateBrainKey(provider, pt) : undefined,
      },
      requester,
    );
  }
  return stored;
}

/**
 * BYOK connect flow's server side (issue #15, roles-and-api-key-guide.md
 * Part 3). GET reports whether a key is connected (status + masked
 * fingerprint only — Vault.getBrainKeyStatus never returns material).
 * POST validates live against the real provider before ever calling
 * vault.storeBrainKey (Vault itself enforces this via the `validate` hook
 * — see ValidationFailedError below).
 *
 * "/" is the v1 whole-tenant behavior, unchanged: stores the SAME key
 * under every team id this tenant's org chart has (or the
 * DEFAULT_BRAIN_ROLE_ID sentinel if none is claimed yet), so a real task
 * submitted against any team can already find its Brain key today.
 *
 * "/:roleId" (Brain-per-role, first slice) targets exactly one role
 * instead of fanning out across the whole org chart — the plumbing a real
 * per-role picker UI needs, landed ahead of that UI itself. The vault
 * layer was already fully (tenantId, roleId)-scoped (see ADR-002/#15);
 * this is the connect-flow route catching up to it. Still not the full
 * per-role picker (issue #13) — no recommendation engine exists yet
 * (Agent.brain is still null everywhere), and nothing in apps/web calls
 * this route yet. It exists so that UI has somewhere real to call once
 * built, rather than landing route and UI in the same change.
 */
export function brainKeyRoute(deps: BrainKeyRouteDeps) {
  return new Hono<AppEnv>()
    .get("/", async (c) => {
      const tenantId = c.get("tenantId");
      const [roleId] = await roleIdsForTenant(deps, tenantId);
      return c.json(await statusForRole(deps, tenantId, roleId));
    })
    .get("/:roleId", async (c) => {
      const tenantId = c.get("tenantId");
      const roleId = c.req.param("roleId");
      return c.json(await statusForRole(deps, tenantId, roleId));
    })
    .post("/", zValidator("json", connectSchema), async (c) => {
      const { provider, apiKey } = c.req.valid("json");
      const tenantId = c.get("tenantId");
      const requester: RequesterIdentity = { kind: "tenant-user", userId: c.get("session").user.id };
      const roleIds = await roleIdsForTenant(deps, tenantId);
      const plaintext = Buffer.from(apiKey, "utf8");
      try {
        const stored = await storeForRoles(deps, tenantId, requester, provider, plaintext, roleIds);
        return c.json({ key: stored }, 201);
      } catch (err) {
        if (err instanceof ValidationFailedError) {
          return c.json({ error: "That key didn't validate with the provider. Double-check it and try again." }, 422);
        }
        throw err;
      } finally {
        plaintext.fill(0);
      }
    })
    .post("/:roleId", zValidator("json", connectSchema), async (c) => {
      const { provider, apiKey } = c.req.valid("json");
      const tenantId = c.get("tenantId");
      const requester: RequesterIdentity = { kind: "tenant-user", userId: c.get("session").user.id };
      const plaintext = Buffer.from(apiKey, "utf8");
      try {
        const stored = await storeForRoles(deps, tenantId, requester, provider, plaintext, [c.req.param("roleId")]);
        return c.json({ key: stored }, 201);
      } catch (err) {
        if (err instanceof ValidationFailedError) {
          return c.json({ error: "That key didn't validate with the provider. Double-check it and try again." }, 422);
        }
        throw err;
      } finally {
        plaintext.fill(0);
      }
    });
}
