import { zValidator } from "@hono/zod-validator";
import type { SignupExtractionBatchStore } from "@byok/db";
import type { Vault } from "@byok/vault";
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
  vault: Pick<Vault, "storeBrainKey" | "getBrainKeyStatus">;
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

/**
 * BYOK connect flow's server side (issue #15, roles-and-api-key-guide.md
 * Part 3). GET reports whether a key is connected (status + masked
 * fingerprint only — Vault.getBrainKeyStatus never returns material).
 * POST validates live against the real provider before ever calling
 * vault.storeBrainKey (Vault itself enforces this via the `validate` hook
 * — see ValidationFailedError below), then stores the SAME key under
 * every team id this tenant's org chart has (or the DEFAULT_BRAIN_ROLE_ID
 * sentinel if none is claimed yet), so a real task submitted against any
 * team can already find its Brain key today, without waiting on issue #13.
 */
export function brainKeyRoute(deps: BrainKeyRouteDeps) {
  return new Hono<AppEnv>()
    .get("/", async (c) => {
      const tenantId = c.get("tenantId");
      const [roleId] = await roleIdsForTenant(deps, tenantId);
      const status = deps.vault.getBrainKeyStatus(tenantId, roleId);
      return c.json({ connected: status !== null, key: status });
    })
    .post("/", zValidator("json", connectSchema), async (c) => {
      const { provider, apiKey } = c.req.valid("json");
      const tenantId = c.get("tenantId");
      const session = c.get("session");
      const requester = { kind: "tenant-user" as const, userId: session.user.id };
      const roleIds = await roleIdsForTenant(deps, tenantId);
      const plaintext = Buffer.from(apiKey, "utf8");

      try {
        let stored;
        for (const [index, roleId] of roleIds.entries()) {
          stored = await deps.vault.storeBrainKey(
            {
              tenantId,
              roleId,
              provider,
              plaintext,
              // One real provider call for the whole batch, not one per
              // team — same key, same provider, re-validating per role
              // would just be N redundant calls to the same endpoint.
              validate: index === 0 ? (pt) => validateBrainKey(provider, pt) : undefined,
            },
            requester,
          );
        }
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
