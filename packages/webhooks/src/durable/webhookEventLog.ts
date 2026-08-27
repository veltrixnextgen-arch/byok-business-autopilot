import { withTenantScope, type PoolLike } from "@byok/db";
import { isDevOrTestEnvironment } from "@byok/vault";
import type { VerifiedWebhookEvent, WebhookProvider } from "../types.js";

export class DevOnlyWebhookEventLogGuardError extends Error {}

/**
 * Capture-only, same discipline as R5's own chain store and this
 * session's earlier template-learning capture layer: durably records
 * every VERIFIED webhook event, per tenant, with zero dispatch wiring —
 * "receive, verify, record" is the whole job of this PR. What (if
 * anything) reads this log to trigger a chain is a later PR, once R5's
 * own dispatch wiring exists to trigger.
 */
export interface WebhookEventLog {
  record(tenantId: string, event: VerifiedWebhookEvent): Promise<void>;
  recentForTenant(tenantId: string, limit?: number): Promise<VerifiedWebhookEvent[]>;
}

export class InMemoryWebhookEventLog implements WebhookEventLog {
  private readonly events = new Map<string, VerifiedWebhookEvent[]>();

  constructor() {
    if (!isDevOrTestEnvironment()) {
      throw new DevOnlyWebhookEventLogGuardError(
        "InMemoryWebhookEventLog cannot be constructed outside a dev or test environment — " +
          "use PostgresWebhookEventLog for any deployed environment.",
      );
    }
  }

  async record(tenantId: string, event: VerifiedWebhookEvent): Promise<void> {
    const existing = this.events.get(tenantId) ?? [];
    existing.unshift(event);
    this.events.set(tenantId, existing);
  }

  async recentForTenant(tenantId: string, limit = 50): Promise<VerifiedWebhookEvent[]> {
    return (this.events.get(tenantId) ?? []).slice(0, limit);
  }
}

interface WebhookEventRow {
  provider: WebhookProvider;
  event_type: string;
  payload: unknown;
  received_at: string;
}

function rowToEvent(row: WebhookEventRow): VerifiedWebhookEvent {
  return { provider: row.provider, eventType: row.event_type, payload: row.payload, receivedAt: row.received_at };
}

export class PostgresWebhookEventLog implements WebhookEventLog {
  constructor(private readonly pool: PoolLike) {}

  async record(tenantId: string, event: VerifiedWebhookEvent): Promise<void> {
    await withTenantScope(this.pool, tenantId, async (client) => {
      await client.query(
        `INSERT INTO webhook_events (tenant_id, provider, event_type, payload, received_at)
         VALUES ($1::uuid, $2, $3, $4::jsonb, $5)`,
        [tenantId, event.provider, event.eventType, JSON.stringify(event.payload), event.receivedAt],
      );
    });
  }

  async recentForTenant(tenantId: string, limit = 50): Promise<VerifiedWebhookEvent[]> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT provider, event_type, payload, received_at FROM webhook_events
         WHERE tenant_id = $1::uuid ORDER BY received_at DESC LIMIT $2`,
        [tenantId, limit],
      )) as unknown as { rows: WebhookEventRow[] };
      return result.rows.map(rowToEvent);
    });
  }
}
