import { withTenantScope, type PoolLike } from "@byok/db";
import { isDevOrTestEnvironment } from "@byok/vault";
import type { WebhookProvider } from "../types.js";

export class DevOnlyWebhookSecretStoreGuardError extends Error {}

/**
 * Per-(tenant, provider) webhook signing secret storage. Deliberately
 * NOT "we generate a secret and hand it to the tenant" the way Brain/
 * Hands keys work — for Stripe specifically (the one provider this PR
 * implements), STRIPE generates the signing secret when the tenant
 * configures a webhook endpoint in their own Stripe dashboard pointing
 * at our per-tenant URL; the tenant then gives US that secret to store,
 * same "paste a key we validate/store" shape the Brain-key connect flow
 * already uses (apps/api/src/routes/brainKeys.ts), just for a webhook
 * signing secret instead of an LLM provider API key.
 *
 * ponytail: stored as plaintext in an RLS-protected column, not
 * Vault-encrypted like Brain/Hands keys — a leaked webhook secret lets
 * someone send us FORGED events claiming to be that tenant's account,
 * real but bounded (nothing dispatches automatically from a webhook
 * event yet — R6's own event log is capture-only, same as R5's chains
 * before their dispatch wiring lands). Upgrade path: route this through
 * Vault's own encrypt/decrypt primitives once a real dispatch path
 * exists downstream of a verified event and the blast radius actually
 * changes.
 */
export interface WebhookEndpointSecretStore {
  set(tenantId: string, provider: WebhookProvider, secret: string): Promise<void>;
  get(tenantId: string, provider: WebhookProvider): Promise<string | null>;
  /** Status only — never the secret value. Mirrors Vault's own
   *  getBrainKeyStatus/getHandsKeyStatus "is something connected" read,
   *  the shape every existing connect-flow status check in this
   *  codebase already uses. */
  isConfigured(tenantId: string, provider: WebhookProvider): Promise<boolean>;
}

export class InMemoryWebhookEndpointSecretStore implements WebhookEndpointSecretStore {
  private readonly secrets = new Map<string, string>();

  constructor() {
    if (!isDevOrTestEnvironment()) {
      throw new DevOnlyWebhookSecretStoreGuardError(
        "InMemoryWebhookEndpointSecretStore cannot be constructed outside a dev or test environment — " +
          "use PostgresWebhookEndpointSecretStore for any deployed environment.",
      );
    }
  }

  private key(tenantId: string, provider: WebhookProvider): string {
    return `${tenantId}|${provider}`;
  }

  async set(tenantId: string, provider: WebhookProvider, secret: string): Promise<void> {
    this.secrets.set(this.key(tenantId, provider), secret);
  }

  async get(tenantId: string, provider: WebhookProvider): Promise<string | null> {
    return this.secrets.get(this.key(tenantId, provider)) ?? null;
  }

  async isConfigured(tenantId: string, provider: WebhookProvider): Promise<boolean> {
    return this.secrets.has(this.key(tenantId, provider));
  }
}

export class PostgresWebhookEndpointSecretStore implements WebhookEndpointSecretStore {
  constructor(private readonly pool: PoolLike) {}

  async set(tenantId: string, provider: WebhookProvider, secret: string): Promise<void> {
    await withTenantScope(this.pool, tenantId, async (client) => {
      await client.query(
        `INSERT INTO webhook_endpoint_secrets (tenant_id, provider, secret, updated_at)
         VALUES ($1::uuid, $2, $3, now())
         ON CONFLICT (tenant_id, provider) DO UPDATE SET secret = $3, updated_at = now()`,
        [tenantId, provider, secret],
      );
    });
  }

  async get(tenantId: string, provider: WebhookProvider): Promise<string | null> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT secret FROM webhook_endpoint_secrets WHERE tenant_id = $1::uuid AND provider = $2`,
        [tenantId, provider],
      )) as unknown as { rows: { secret: string }[] };
      return result.rows[0]?.secret ?? null;
    });
  }

  async isConfigured(tenantId: string, provider: WebhookProvider): Promise<boolean> {
    return (await this.get(tenantId, provider)) !== null;
  }
}
