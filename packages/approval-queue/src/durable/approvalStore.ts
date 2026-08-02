import { insertAuditEvent, withTenantScope, type DurableAuditLog, type PoolLike } from "@byok/db";
import { UnknownActionError, UnknownRecommendationError, type ProposedAction, type RecommendationItem, type Verdict } from "../types.js";

export interface ResolveOutcome {
  action: ProposedAction;
  wasSpotCheck: boolean;
}

/** Async, tenant-scoped counterpart to ApprovalQueue's in-memory pending
 *  Maps (queue.ts) — item state (pending/resolved) + the verdict, durable
 *  across process restarts. */
export interface DurableApprovalStore {
  submitProposedAction(action: ProposedAction, spotCheck: boolean): Promise<void>;
  submitRecommendation(item: RecommendationItem): Promise<void>;
  resolve(tenantId: string, id: string, verdict: Verdict): Promise<ResolveOutcome>;
  resolveRecommendation(tenantId: string, id: string): Promise<RecommendationItem>;
  pendingActions(tenantId: string): Promise<readonly ProposedAction[]>;
  pendingRecommendations(tenantId: string): Promise<readonly RecommendationItem[]>;
}

interface StoredItem {
  kind: "proposed-action" | "recommendation";
  payload: ProposedAction | RecommendationItem;
  status: "pending" | "resolved";
  spotCheck: boolean;
  verdict?: Verdict;
}

export class InMemoryDurableApprovalStore implements DurableApprovalStore {
  private readonly items = new Map<string, StoredItem>();

  async submitProposedAction(action: ProposedAction, spotCheck: boolean): Promise<void> {
    this.items.set(action.id, { kind: "proposed-action", payload: action, status: "pending", spotCheck });
  }

  async submitRecommendation(item: RecommendationItem): Promise<void> {
    this.items.set(item.id, { kind: "recommendation", payload: item, status: "pending", spotCheck: false });
  }

  async resolve(tenantId: string, id: string, verdict: Verdict): Promise<ResolveOutcome> {
    const item = this.items.get(id);
    if (!item || item.kind !== "proposed-action" || item.status !== "pending" || item.payload.tenantId !== tenantId) {
      throw new UnknownActionError(`No pending action "${id}" for tenant "${tenantId}".`);
    }
    item.status = "resolved";
    item.verdict = verdict;
    return { action: item.payload as ProposedAction, wasSpotCheck: item.spotCheck };
  }

  async resolveRecommendation(tenantId: string, id: string): Promise<RecommendationItem> {
    const item = this.items.get(id);
    if (!item || item.kind !== "recommendation" || item.status !== "pending" || item.payload.tenantId !== tenantId) {
      throw new UnknownRecommendationError(`No pending recommendation "${id}" for tenant "${tenantId}".`);
    }
    item.status = "resolved";
    return item.payload as RecommendationItem;
  }

  async pendingActions(tenantId: string): Promise<readonly ProposedAction[]> {
    return [...this.items.values()]
      .filter((i) => i.kind === "proposed-action" && i.status === "pending" && i.payload.tenantId === tenantId)
      .map((i) => i.payload as ProposedAction);
  }

  async pendingRecommendations(tenantId: string): Promise<readonly RecommendationItem[]> {
    return [...this.items.values()]
      .filter((i) => i.kind === "recommendation" && i.status === "pending" && i.payload.tenantId === tenantId)
      .map((i) => i.payload as RecommendationItem);
  }
}

export class PostgresDurableApprovalStore implements DurableApprovalStore {
  constructor(
    private readonly pool: PoolLike,
    private readonly audit?: DurableAuditLog,
  ) {}

  async submitProposedAction(action: ProposedAction, spotCheck: boolean): Promise<void> {
    await withTenantScope(this.pool, action.tenantId, async (client) => {
      await client.query(
        `INSERT INTO approval_queue_items (id, tenant_id, kind, task_type, payload, spot_check)
         VALUES ($1::uuid, $2::uuid, 'proposed-action', $3, $4::jsonb, $5)`,
        [action.id, action.tenantId, action.taskType, JSON.stringify(action), spotCheck],
      );
      if (this.audit) {
        await insertAuditEvent(client, { tenantId: action.tenantId, source: "approval-queue", kind: "queued", refId: action.id });
      }
    });
  }

  async submitRecommendation(item: RecommendationItem): Promise<void> {
    await withTenantScope(this.pool, item.tenantId, async (client) => {
      await client.query(`INSERT INTO approval_queue_items (id, tenant_id, kind, payload) VALUES ($1::uuid, $2::uuid, 'recommendation', $3::jsonb)`, [
        item.id,
        item.tenantId,
        JSON.stringify(item),
      ]);
      if (this.audit) {
        await insertAuditEvent(client, { tenantId: item.tenantId, source: "approval-queue", kind: "recommendation-submitted", refId: item.id });
      }
    });
  }

  async resolve(tenantId: string, id: string, verdict: Verdict): Promise<ResolveOutcome> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      // Atomic: only resolves a row that is still pending — the WHERE
      // clause is what stops a resolve() from racing itself (e.g. a
      // duplicate webhook delivering the same human decision twice) into
      // dispatching an effect more than once.
      const result = (await client.query(
        `UPDATE approval_queue_items SET status='resolved', verdict=$1::jsonb, resolved_at=now()
         WHERE id=$2::uuid AND tenant_id=$3::uuid AND kind='proposed-action' AND status='pending'
         RETURNING payload, spot_check`,
        [JSON.stringify(verdict), id, tenantId],
      )) as unknown as { rows: Array<{ payload: ProposedAction; spot_check: boolean }> };

      const row = result.rows[0];
      if (!row) throw new UnknownActionError(`No pending action "${id}" for tenant "${tenantId}".`);

      if (this.audit) {
        await insertAuditEvent(client, { tenantId, source: "approval-queue", kind: verdict.kind, refId: id });
      }

      return { action: row.payload, wasSpotCheck: row.spot_check };
    });
  }

  async resolveRecommendation(tenantId: string, id: string): Promise<RecommendationItem> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `UPDATE approval_queue_items SET status='resolved', resolved_at=now()
         WHERE id=$1::uuid AND tenant_id=$2::uuid AND kind='recommendation' AND status='pending'
         RETURNING payload`,
        [id, tenantId],
      )) as unknown as { rows: Array<{ payload: RecommendationItem }> };

      const row = result.rows[0];
      if (!row) throw new UnknownRecommendationError(`No pending recommendation "${id}" for tenant "${tenantId}".`);
      return row.payload;
    });
  }

  async pendingActions(tenantId: string): Promise<readonly ProposedAction[]> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT payload FROM approval_queue_items WHERE tenant_id=$1::uuid AND kind='proposed-action' AND status='pending'`,
        [tenantId],
      )) as unknown as { rows: Array<{ payload: ProposedAction }> };
      return result.rows.map((r) => r.payload);
    });
  }

  async pendingRecommendations(tenantId: string): Promise<readonly RecommendationItem[]> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT payload FROM approval_queue_items WHERE tenant_id=$1::uuid AND kind='recommendation' AND status='pending'`,
        [tenantId],
      )) as unknown as { rows: Array<{ payload: RecommendationItem }> };
      return result.rows.map((r) => r.payload);
    });
  }
}
