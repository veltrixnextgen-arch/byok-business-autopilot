import { withTenantScope, type PoolLike } from "@byok/db";
import { isDevOrTestEnvironment } from "@byok/vault";
import type { RouterTaskStatus } from "../types.js";

export class DevOnlyTaskLedgerGuardError extends Error {}

export interface DurableLedgerEntry {
  tenantId: string;
  taskId: string;
  subAgentId: string;
  status: RouterTaskStatus;
  note?: string;
}

export interface StoredDurableLedgerEntry extends DurableLedgerEntry {
  at: string;
}

/** Tenant-scoped, durable ledger — #120: replaced the old synchronous,
 *  process-local TaskLedger, which this codebase no longer has. */
export interface DurableTaskLedger {
  append(entry: DurableLedgerEntry): Promise<void>;
  entriesFor(tenantId: string, subAgentId: string): Promise<readonly StoredDurableLedgerEntry[]>;
}

export class InMemoryDurableTaskLedger implements DurableTaskLedger {
  private readonly entries: StoredDurableLedgerEntry[] = [];

  // ADR-028's principle, applied per #120: a construction guard lands with
  // the durability fix, never added after the fact. This class resets on
  // every restart and nothing outside this process can ever see an entry
  // held in it — same reasoning as every other InMemoryDurableXStore in
  // this codebase (approvalStore.ts, autonomyStore.ts, vault's
  // dekRecordStore.ts).
  constructor() {
    if (!isDevOrTestEnvironment()) {
      throw new DevOnlyTaskLedgerGuardError(
        "InMemoryDurableTaskLedger cannot be constructed outside a dev or test environment — " +
          "use PostgresDurableTaskLedger for any deployed environment.",
      );
    }
  }

  async append(entry: DurableLedgerEntry): Promise<void> {
    this.entries.push({ ...entry, at: new Date().toISOString() });
  }

  async entriesFor(tenantId: string, subAgentId: string): Promise<readonly StoredDurableLedgerEntry[]> {
    return this.entries.filter((e) => e.tenantId === tenantId && e.subAgentId === subAgentId);
  }
}

interface TaskLedgerRow {
  tenant_id: string;
  task_id: string;
  sub_agent_id: string;
  status: string;
  note: string | null;
  at: string;
}

function rowToEntry(row: TaskLedgerRow): StoredDurableLedgerEntry {
  return {
    tenantId: row.tenant_id,
    taskId: row.task_id,
    subAgentId: row.sub_agent_id,
    status: row.status as RouterTaskStatus,
    note: row.note ?? undefined,
    at: row.at,
  };
}

export class PostgresDurableTaskLedger implements DurableTaskLedger {
  constructor(private readonly pool: PoolLike) {}

  async append(entry: DurableLedgerEntry): Promise<void> {
    await withTenantScope(this.pool, entry.tenantId, async (client) => {
      await client.query(
        `INSERT INTO task_ledger_entries (tenant_id, task_id, sub_agent_id, status, note) VALUES ($1::uuid, $2::uuid, $3, $4, $5)`,
        [entry.tenantId, entry.taskId, entry.subAgentId, entry.status, entry.note ?? null],
      );
    });
  }

  async entriesFor(tenantId: string, subAgentId: string): Promise<readonly StoredDurableLedgerEntry[]> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT tenant_id, task_id, sub_agent_id, status, note, at
         FROM task_ledger_entries WHERE tenant_id=$1::uuid AND sub_agent_id=$2 ORDER BY at`,
        [tenantId, subAgentId],
      )) as unknown as { rows: TaskLedgerRow[] };
      return result.rows.map(rowToEntry);
    });
  }
}
