import { withTenantScope, type PoolLike } from "./tenantContext.js";

// §7's required instrumentation, built alongside the scheduler rather than
// retrofitted (docs/architecture/automation-runtime-plan.md: "We cannot
// price what we cannot see... that feeds an internal COGS-per-company view
// so the tier floors ... can be corrected against real data rather than
// these estimates"). One row per tenant per day (server-side CURRENT_DATE
// — a single, consistent day boundary, not a client-supplied one).
export interface DailyInstrumentation {
  tenantId: string;
  day: string;
  scheduledRunsExecuted: number;
  eventTriggersReceived: number;
  chainStepsCompleted: number;
  ledgerRowsWritten: number;
  workerSecondsConsumed: number;
}

interface DailyInstrumentationRow {
  tenant_id: string;
  day: string;
  scheduled_runs_executed: number;
  event_triggers_received: number;
  chain_steps_completed: number;
  ledger_rows_written: number;
  worker_seconds_consumed: string; // numeric comes back as a string from pg
}

function rowToDaily(row: DailyInstrumentationRow): DailyInstrumentation {
  return {
    tenantId: row.tenant_id,
    day: row.day,
    scheduledRunsExecuted: row.scheduled_runs_executed,
    eventTriggersReceived: row.event_triggers_received,
    chainStepsCompleted: row.chain_steps_completed,
    ledgerRowsWritten: row.ledger_rows_written,
    workerSecondsConsumed: Number(row.worker_seconds_consumed),
  };
}

async function increment(
  pool: PoolLike,
  tenantId: string,
  column: "scheduled_runs_executed" | "event_triggers_received" | "chain_steps_completed" | "ledger_rows_written",
  by: number,
): Promise<void> {
  await withTenantScope(pool, tenantId, async (client) => {
    await client.query(
      `INSERT INTO scheduler_instrumentation_daily (tenant_id, day, ${column})
       VALUES ($1::uuid, CURRENT_DATE, $2)
       ON CONFLICT (tenant_id, day) DO UPDATE SET ${column} = scheduler_instrumentation_daily.${column} + $2`,
      [tenantId, by],
    );
  });
}

/**
 * R3 only ever calls `recordScheduledRun` for real (the scheduled-dispatch
 * worker, once per job it processes). `recordEventTrigger`/`recordChainStep`
 * exist now — per the explicit instruction to build this meter with the
 * scheduler, not after it — but have no real caller yet: R5 (task chains)
 * and R6 (event triggers) are what will actually call them. Zero rows with
 * nonzero values in those two columns is the honest, current state.
 */
export class SchedulerInstrumentationStore {
  constructor(private readonly pool: PoolLike) {}

  async recordScheduledRun(tenantId: string, input: { workerSeconds: number; ledgerRowsWritten: number }): Promise<void> {
    await withTenantScope(this.pool, tenantId, async (client) => {
      await client.query(
        `INSERT INTO scheduler_instrumentation_daily
           (tenant_id, day, scheduled_runs_executed, ledger_rows_written, worker_seconds_consumed)
         VALUES ($1::uuid, CURRENT_DATE, 1, $2, $3)
         ON CONFLICT (tenant_id, day) DO UPDATE SET
           scheduled_runs_executed = scheduler_instrumentation_daily.scheduled_runs_executed + 1,
           ledger_rows_written = scheduler_instrumentation_daily.ledger_rows_written + $2,
           worker_seconds_consumed = scheduler_instrumentation_daily.worker_seconds_consumed + $3`,
        [tenantId, input.ledgerRowsWritten, input.workerSeconds],
      );
    });
  }

  async recordEventTrigger(tenantId: string): Promise<void> {
    await increment(this.pool, tenantId, "event_triggers_received", 1);
  }

  async recordChainStep(tenantId: string): Promise<void> {
    await increment(this.pool, tenantId, "chain_steps_completed", 1);
  }

  async getDaily(tenantId: string, day: string): Promise<DailyInstrumentation | null> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT tenant_id, day, scheduled_runs_executed, event_triggers_received, chain_steps_completed,
                ledger_rows_written, worker_seconds_consumed
         FROM scheduler_instrumentation_daily WHERE tenant_id = $1::uuid AND day = $2::date`,
        [tenantId, day],
      )) as unknown as { rows: DailyInstrumentationRow[] };
      return result.rows[0] ? rowToDaily(result.rows[0]) : null;
    });
  }

  async listRange(tenantId: string, fromDay: string, toDay: string): Promise<DailyInstrumentation[]> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT tenant_id, day, scheduled_runs_executed, event_triggers_received, chain_steps_completed,
                ledger_rows_written, worker_seconds_consumed
         FROM scheduler_instrumentation_daily
         WHERE tenant_id = $1::uuid AND day BETWEEN $2::date AND $3::date
         ORDER BY day`,
        [tenantId, fromDay, toDay],
      )) as unknown as { rows: DailyInstrumentationRow[] };
      return result.rows.map(rowToDaily);
    });
  }
}
