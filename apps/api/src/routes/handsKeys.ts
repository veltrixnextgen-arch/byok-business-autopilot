import { zValidator } from "@hono/zod-validator";
import type { Vault } from "@byok/vault";
import { Hono } from "hono";
import { z } from "zod";
import type { AppEnv } from "../context.js";

export interface HandsKeyRouteDeps {
  vault: Pick<Vault, "storeHandsKey" | "getHandsKeyStatus">;
}

const statusQuerySchema = z.object({
  subAgentId: z.string().min(1),
  capabilityScope: z.string().min(1),
});

const connectSchema = z.object({
  subAgentId: z.string().min(1),
  capabilityScope: z.string().min(1),
  service: z.string().min(1),
  apiKey: z.string().min(1),
});

/**
 * Just-in-time Hands connect flow (issue #22, roles-and-api-key-guide.md
 * Screen 12: "Connect now or skip; agents without tools work in draft
 * mode"). Deliberately per (subAgentId, capabilityScope) — unlike Brain
 * keys, Hands are per-sub-agent/per-capability by design (ADR-002), so
 * there's no single "connected" flag for a tenant, only per-pair status.
 *
 * No live validation call before storing, unlike brainKeys.ts: Brain
 * providers are a known set of 4 with a free auth-check endpoint each
 * (providerValidation.ts); Hands services are an open-ended catalog
 * (docs/design/tool-registry.md §2) with no shared "check this key
 * works" shape (most aren't even API-key auth — tool-registry.md's own
 * recommendation is OAuth wherever a service offers it). Storing without
 * a live check is honest about that: a bad key surfaces the first time
 * the connected tool is actually called (handsTool.ts's own isError
 * path), same as it would for any first real use.
 */
export function handsKeyRoute(deps: HandsKeyRouteDeps) {
  return new Hono<AppEnv>()
    .get("/", zValidator("query", statusQuerySchema), (c) => {
      const { subAgentId, capabilityScope } = c.req.valid("query");
      const tenantId = c.get("tenantId");
      const status = deps.vault.getHandsKeyStatus(tenantId, subAgentId, capabilityScope);
      return c.json({ connected: status !== null, key: status });
    })
    .post("/", zValidator("json", connectSchema), async (c) => {
      const { subAgentId, capabilityScope, service, apiKey } = c.req.valid("json");
      const tenantId = c.get("tenantId");
      const session = c.get("session");
      const plaintext = Buffer.from(apiKey, "utf8");

      try {
        const key = await deps.vault.storeHandsKey(
          { tenantId, subAgentId, capabilityScope, service, plaintext },
          { kind: "tenant-user", userId: session.user.id },
        );
        return c.json({ key }, 201);
      } finally {
        plaintext.fill(0);
      }
    });
}
