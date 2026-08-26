import { withTenantScope, type PoolClientLike, type PoolLike } from "./tenantContext.js";

/**
 * Shared unified audit log (audit_log table, migrations/0002_durable_storage.sql)
 * — see that file's header for why it's one table with a `source` column
 * rather than per-source tables. Exported from @byok/db's public interface
 * so trust-core packages (cost-gate, approval-queue, vault) can write to it
 * without a deep import. Originally landed alongside each package's own
 * bespoke sync in-memory audit log (GateAuditLog, Vault's AuditLog); issues
 * #149/#150 replaced both of those with this shared interface directly —
 * see costGate.ts's and vault.ts's own construction guard comments.
 */
export type AuditSource = "cost-gate" | "approval-queue" | "vault";

export interface DurableAuditEvent {
  tenantId: string;
  source: AuditSource;
  kind: string;
  refId?: string;
  detail?: Record<string, unknown>;
}

export interface StoredAuditEvent extends DurableAuditEvent {
  id: string;
  at: string;
}

export interface DurableAuditLog {
  append(event: DurableAuditEvent): Promise<void>;
  recentForTenant(tenantId: string, limit?: number): Promise<StoredAuditEvent[]>;
}

interface AuditLogRow {
  id: string;
  tenant_id: string;
  source: AuditSource;
  kind: string;
  ref_id: string | null;
  detail: Record<string, unknown> | null;
  at: string;
}

function rowToEvent(row: AuditLogRow): StoredAuditEvent {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    source: row.source,
    kind: row.kind,
    refId: row.ref_id ?? undefined,
    detail: row.detail ?? undefined,
    at: row.at,
  };
}

/**
 * Inserts one audit row using an already-open client — the point of
 * taking a client rather than a pool is so a caller mid-transaction (e.g.
 * PostgresReservationStore.reserveAtomic) can append the audit row as
 * part of the SAME atomic transaction as the state change it's auditing,
 * instead of a separate round-trip that could succeed or fail
 * independently of it.
 */
export async function insertAuditEvent(client: PoolClientLike, event: DurableAuditEvent): Promise<void> {
  await client.query(
    `INSERT INTO audit_log (tenant_id, source, kind, ref_id, detail)
     VALUES ($1::uuid, $2, $3, $4, $5::jsonb)`,
    [event.tenantId, event.source, event.kind, event.refId ?? null, event.detail ? JSON.stringify(event.detail) : null],
  );
}

export class InMemoryDurableAuditLog implements DurableAuditLog {
  private readonly events: StoredAuditEvent[] = [];
  private nextId = 1;

  async append(event: DurableAuditEvent): Promise<void> {
    this.events.push({ id: String(this.nextId++), at: new Date().toISOString(), ...event });
  }

  async recentForTenant(tenantId: string, limit = 50): Promise<StoredAuditEvent[]> {
    // Newest-first by insertion order, not by comparing `at` strings —
    // two events appended within the same millisecond (routine on a fast
    // CI runner) would otherwise tie, and a tie-break on wall-clock time
    // alone can't distinguish them correctly.
    return this.events
      .filter((e) => e.tenantId === tenantId)
      .slice()
      .reverse()
      .slice(0, limit);
  }
}

export class PostgresDurableAuditLog implements DurableAuditLog {
  constructor(private readonly pool: PoolLike) {}

  async append(event: DurableAuditEvent): Promise<void> {
    await withTenantScope(this.pool, event.tenantId, (client) => insertAuditEvent(client, event));
  }

  async recentForTenant(tenantId: string, limit = 50): Promise<StoredAuditEvent[]> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      // ORDER BY seq, not `at`: now() is transaction-start time in
      // Postgres, so two events appended within the same transaction (e.g.
      // a reservation and its audit row, committed together) would
      // otherwise tie on `at` with no defined order between them. seq is a
      // real monotonic sequence regardless of transaction boundaries.
      const result = (await client.query(
        `SELECT id, tenant_id, source, kind, ref_id, detail, at
         FROM audit_log WHERE tenant_id = $1::uuid ORDER BY seq DESC LIMIT $2`,
        [tenantId, limit],
      )) as unknown as { rows: AuditLogRow[] };
      return result.rows.map(rowToEvent);
    });
  }
}
