import { insertAuditEvent, withTenantScope, type DurableAuditLog, type PoolLike } from "@byok/db";
import { randomUUID } from "node:crypto";
import { isDevOrTestEnvironment } from "@byok/vault";
import type { CeilingConfig, CeilingLevel } from "../ceilings.js";

export class DevOnlyReservationStoreGuardError extends Error {}

export interface ReserveAtomicInput {
  tenantId: string;
  taskId: string;
  roleId: string;
  taskType: string;
  amountUsd: number;
}

export interface ReserveAtomicResult {
  withinCeiling: boolean;
  exceededLevel?: CeilingLevel;
  detail?: string;
  reservationId?: string;
}

export class UnknownOrResolvedReservationError extends Error {}

export interface DurableReservationStore {
  /**
   * Checks all three ceiling levels (company, role, task-type — in that
   * order) AND commits the reservation in one atomic operation. This is
   * the durable-storage replacement for reservations.ts's synchronous
   * "no await between check and reserve" trick: since this now crosses a
   * real network round-trip, atomicity has to come from the database
   * instead of the JS event loop.
   */
  reserveAtomic(input: ReserveAtomicInput, ceilings: CeilingConfig): Promise<ReserveAtomicResult>;
  settle(tenantId: string, reservationId: string, actualUsd: number): Promise<void>;
  release(tenantId: string, reservationId: string): Promise<void>;
  totals(tenantId: string, level: CeilingLevel, scopeKey: string): Promise<{ totalUsd: number; ceilingUsd: number | null }>;
}

/** UTC calendar day the counter resets on — no cron job, a new day is
 *  just a scope_key nothing has written to yet. */
function utcDay(when: Date = new Date()): string {
  return when.toISOString().slice(0, 10);
}

function levelsFor(
  input: ReserveAtomicInput,
  ceilings: CeilingConfig,
  day: string,
): Array<{ level: CeilingLevel; scopeKey: string; ceilingUsd: number | null }> {
  return [
    { level: "company", scopeKey: "company", ceilingUsd: ceilings.companyMonthlyUsd },
    { level: "role", scopeKey: input.roleId, ceilingUsd: ceilings.perRoleUsd[input.roleId] ?? null },
    { level: "task-type", scopeKey: input.taskType, ceilingUsd: ceilings.perTaskTypeUsd[input.taskType] ?? null },
    { level: "task-type-day", scopeKey: `${input.taskType}:${day}`, ceilingUsd: ceilings.perTaskTypePerDayUsd ?? null },
  ];
}

/**
 * Test fake — same async interface as the Postgres implementation, no
 * network/Docker required. Each method has no `await` internally, so
 * (like the original in-memory ReservationLedger) it's naturally atomic
 * per call under JS's single-threaded run-to-completion; it does NOT
 * exercise the actual cross-process race the Postgres implementation is
 * built to close — that's what the integration suite is for.
 */
export class InMemoryDurableReservationStore implements DurableReservationStore {
  private readonly reservations = new Map<
    string,
    { tenantId: string; roleId: string; taskType: string; amountUsd: number; day: string; status: "reserved" | "settled" | "released" }
  >();
  private readonly counters = new Map<string, { totalUsd: number; ceilingUsd: number | null }>();

  // ADR-026: this class resets on every restart — staging ran on it for
  // months (apps/api/src/dev/devTrustCore.ts) before R3's scheduler made
  // that matter. Refusing to construct outside dev/test means a future
  // deploy target that forgets to wire PostgresReservationStore fails
  // loudly at boot, not silently at the next redeploy.
  constructor() {
    if (!isDevOrTestEnvironment()) {
      throw new DevOnlyReservationStoreGuardError(
        "InMemoryDurableReservationStore cannot be constructed outside a dev or test environment (ADR-026) — " +
          "use PostgresReservationStore for any deployed environment.",
      );
    }
  }

  private key(tenantId: string, level: CeilingLevel, scopeKey: string): string {
    return `${tenantId}|${level}|${scopeKey}`;
  }

  async reserveAtomic(input: ReserveAtomicInput, ceilings: CeilingConfig): Promise<ReserveAtomicResult> {
    const day = utcDay();
    const levels = levelsFor(input, ceilings, day);

    for (const { level, scopeKey, ceilingUsd } of levels) {
      const current = this.counters.get(this.key(input.tenantId, level, scopeKey))?.totalUsd ?? 0;
      if (ceilingUsd !== null && current + input.amountUsd > ceilingUsd) {
        return {
          withinCeiling: false,
          exceededLevel: level,
          detail: `${level} ceiling $${ceilingUsd} would be exceeded: $${(current + input.amountUsd).toFixed(4)} projected.`,
        };
      }
    }

    for (const { level, scopeKey, ceilingUsd } of levels) {
      const k = this.key(input.tenantId, level, scopeKey);
      const existing = this.counters.get(k);
      this.counters.set(k, { totalUsd: (existing?.totalUsd ?? 0) + input.amountUsd, ceilingUsd: existing?.ceilingUsd ?? ceilingUsd });
    }

    const reservationId = randomUUID();
    this.reservations.set(reservationId, {
      tenantId: input.tenantId,
      roleId: input.roleId,
      taskType: input.taskType,
      amountUsd: input.amountUsd,
      day,
      status: "reserved",
    });
    return { withinCeiling: true, reservationId };
  }

  async settle(tenantId: string, reservationId: string, actualUsd: number): Promise<void> {
    const reservation = this.getReserved(tenantId, reservationId);
    const delta = actualUsd - reservation.amountUsd;
    reservation.status = "settled";
    reservation.amountUsd = actualUsd;
    this.adjust(tenantId, reservation.roleId, reservation.taskType, reservation.day, delta);
  }

  async release(tenantId: string, reservationId: string): Promise<void> {
    const reservation = this.getReserved(tenantId, reservationId);
    reservation.status = "released";
    this.adjust(tenantId, reservation.roleId, reservation.taskType, reservation.day, -reservation.amountUsd);
  }

  async totals(tenantId: string, level: CeilingLevel, scopeKey: string): Promise<{ totalUsd: number; ceilingUsd: number | null }> {
    return this.counters.get(this.key(tenantId, level, scopeKey)) ?? { totalUsd: 0, ceilingUsd: null };
  }

  private getReserved(tenantId: string, reservationId: string) {
    const reservation = this.reservations.get(reservationId);
    if (!reservation || reservation.tenantId !== tenantId || reservation.status !== "reserved") {
      throw new UnknownOrResolvedReservationError(`No reserved reservation "${reservationId}" for tenant "${tenantId}".`);
    }
    return reservation;
  }

  private adjust(tenantId: string, roleId: string, taskType: string, day: string, deltaUsd: number): void {
    for (const [level, scopeKey] of [
      ["company", "company"],
      ["role", roleId],
      ["task-type", taskType],
      ["task-type-day", `${taskType}:${day}`],
    ] as const) {
      const k = this.key(tenantId, level, scopeKey);
      const existing = this.counters.get(k);
      if (existing) this.counters.set(k, { ...existing, totalUsd: existing.totalUsd + deltaUsd });
    }
  }
}

/**
 * Real fix: reserveAtomic runs entirely inside one Postgres transaction.
 * Each level's check-and-increment is a single UPDATE with the ceiling
 * check baked into its WHERE clause — Postgres takes a row lock on that
 * counter row for the statement's duration, so a concurrent transaction
 * hitting the SAME row blocks until this one commits or rolls back, then
 * re-evaluates the WHERE against the now-current value. That row lock is
 * what makes "check the ceiling" and "commit to spending against it"
 * indivisible from another process's point of view — see
 * migrations/0002_durable_storage.sql's header and the *.itest.ts suite
 * for the concurrent-processes proof.
 */
export class PostgresReservationStore implements DurableReservationStore {
  constructor(
    private readonly pool: PoolLike,
    private readonly audit?: DurableAuditLog,
  ) {}

  async reserveAtomic(input: ReserveAtomicInput, ceilings: CeilingConfig): Promise<ReserveAtomicResult> {
    const levels = levelsFor(input, ceilings, utcDay());

    try {
      const reservationId = await withTenantScope(this.pool, input.tenantId, async (client) => {
        for (const { level, scopeKey, ceilingUsd } of levels) {
          // Ensure the counter row exists (idempotent) so the increment
          // below always hits the UPDATE path, where the WHERE clause is
          // guaranteed to be evaluated — a bare INSERT on first use would
          // otherwise bypass the ceiling check entirely for that first row.
          await client.query(
            `INSERT INTO cost_ledger_counters (tenant_id, level, scope_key, total_usd, ceiling_usd)
             VALUES ($1::uuid, $2, $3, 0, $4)
             ON CONFLICT (tenant_id, level, scope_key) DO NOTHING`,
            [input.tenantId, level, scopeKey, ceilingUsd],
          );

          const result = (await client.query(
            `UPDATE cost_ledger_counters
             SET total_usd = total_usd + $1, updated_at = now()
             WHERE tenant_id = $2::uuid AND level = $3 AND scope_key = $4
               AND (ceiling_usd IS NULL OR total_usd + $1 <= ceiling_usd)
             RETURNING total_usd`,
            [input.amountUsd, input.tenantId, level, scopeKey],
          )) as unknown as { rows: Array<{ total_usd: string }> };

          if (result.rows.length === 0) {
            const projected =
              ((await client.query(`SELECT total_usd FROM cost_ledger_counters WHERE tenant_id=$1::uuid AND level=$2 AND scope_key=$3`, [
                input.tenantId,
                level,
                scopeKey,
              ])) as unknown as { rows: Array<{ total_usd: string }> }).rows[0]?.total_usd ?? "?";
            throw new CeilingExceededError(
              level,
              `${level} ceiling $${ceilingUsd} would be exceeded: current $${projected} + $${input.amountUsd} requested.`,
            );
          }
        }

        const inserted = (await client.query(
          `INSERT INTO cost_reservations (tenant_id, role_id, task_type, amount_usd) VALUES ($1::uuid, $2, $3, $4) RETURNING id`,
          [input.tenantId, input.roleId, input.taskType, input.amountUsd],
        )) as unknown as { rows: Array<{ id: string }> };

        if (this.audit) {
          await insertAuditEvent(client, {
            tenantId: input.tenantId,
            source: "cost-gate",
            kind: "reserved",
            refId: input.taskId,
            detail: { roleId: input.roleId, taskType: input.taskType, amountUsd: input.amountUsd },
          });
        }

        return inserted.rows[0]!.id;
      });

      return { withinCeiling: true, reservationId };
    } catch (err) {
      if (err instanceof CeilingExceededError) {
        return { withinCeiling: false, exceededLevel: err.level, detail: err.message };
      }
      throw err;
    }
  }

  async settle(tenantId: string, reservationId: string, actualUsd: number): Promise<void> {
    await withTenantScope(this.pool, tenantId, async (client) => {
      const locked = (await client.query(
        `SELECT role_id, task_type, amount_usd, status, created_at FROM cost_reservations WHERE id=$1::uuid AND tenant_id=$2::uuid FOR UPDATE`,
        [reservationId, tenantId],
      )) as unknown as { rows: Array<{ role_id: string; task_type: string; amount_usd: string; status: string; created_at: string }> };
      const row = locked.rows[0];
      if (!row || row.status !== "reserved") {
        throw new UnknownOrResolvedReservationError(`No reserved reservation "${reservationId}" for tenant "${tenantId}".`);
      }
      const delta = actualUsd - Number(row.amount_usd);

      await client.query(`UPDATE cost_reservations SET status='settled', resolved_at=now(), amount_usd=$1 WHERE id=$2::uuid`, [
        actualUsd,
        reservationId,
      ]);

      await this.adjustCounters(client, tenantId, row.role_id, row.task_type, utcDay(new Date(row.created_at)), delta);
    });
  }

  async release(tenantId: string, reservationId: string): Promise<void> {
    await withTenantScope(this.pool, tenantId, async (client) => {
      const locked = (await client.query(
        `SELECT role_id, task_type, amount_usd, status, created_at FROM cost_reservations WHERE id=$1::uuid AND tenant_id=$2::uuid FOR UPDATE`,
        [reservationId, tenantId],
      )) as unknown as { rows: Array<{ role_id: string; task_type: string; amount_usd: string; status: string; created_at: string }> };
      const row = locked.rows[0];
      if (!row || row.status !== "reserved") {
        throw new UnknownOrResolvedReservationError(`No reserved reservation "${reservationId}" for tenant "${tenantId}".`);
      }

      await client.query(`UPDATE cost_reservations SET status='released', resolved_at=now() WHERE id=$1::uuid`, [reservationId]);

      await this.adjustCounters(client, tenantId, row.role_id, row.task_type, utcDay(new Date(row.created_at)), -Number(row.amount_usd));
    });
  }

  async totals(tenantId: string, level: CeilingLevel, scopeKey: string): Promise<{ totalUsd: number; ceilingUsd: number | null }> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT total_usd, ceiling_usd FROM cost_ledger_counters WHERE tenant_id=$1::uuid AND level=$2 AND scope_key=$3`,
        [tenantId, level, scopeKey],
      )) as unknown as { rows: Array<{ total_usd: string; ceiling_usd: string | null }> };
      const row = result.rows[0];
      return { totalUsd: row ? Number(row.total_usd) : 0, ceilingUsd: row?.ceiling_usd != null ? Number(row.ceiling_usd) : null };
    });
  }

  private async adjustCounters(
    client: Parameters<Parameters<typeof withTenantScope>[2]>[0],
    tenantId: string,
    roleId: string,
    taskType: string,
    day: string,
    deltaUsd: number,
  ): Promise<void> {
    for (const [level, scopeKey] of [
      ["company", "company"],
      ["role", roleId],
      ["task-type", taskType],
      ["task-type-day", `${taskType}:${day}`],
    ] as const) {
      await client.query(`UPDATE cost_ledger_counters SET total_usd = total_usd + $1, updated_at = now() WHERE tenant_id=$2::uuid AND level=$3 AND scope_key=$4`, [
        deltaUsd,
        tenantId,
        level,
        scopeKey,
      ]);
    }
  }
}

class CeilingExceededError extends Error {
  constructor(
    public readonly level: CeilingLevel,
    message: string,
  ) {
    super(message);
    this.name = "CeilingExceededError";
  }
}
