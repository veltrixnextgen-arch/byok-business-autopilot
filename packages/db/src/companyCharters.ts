import type { Charter, CharterStatus, CompanyCharter, PromptCascade } from "@byok/contracts";
import { withTenantScope, type PoolLike } from "./tenantContext.js";

const SELECT_COLUMNS = "id, tenant_id, version, status, content, cascade, created_at, installed_at";

interface CompanyCharterRow {
  id: string;
  tenant_id: string;
  version: number;
  status: CharterStatus;
  content: Charter;
  cascade: PromptCascade | null;
  created_at: string;
  installed_at: string | null;
}

function rowToCharter(row: CompanyCharterRow): CompanyCharter {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    version: row.version,
    status: row.status,
    content: row.content,
    cascade: row.cascade,
    createdAt: row.created_at,
    installedAt: row.installed_at,
  };
}

/**
 * The versioned Charter (R2, ADR-024). Distinct from
 * SignupExtractionBatchStore's `org_chart.onboardingBatch.charterDraft`,
 * which is the pre-acceptance, pre-tenant LLM draft — this store owns the
 * real, tenant-scoped, versioned record created at Charter acceptance and
 * every edit/reopen after it.
 */
export class CompanyCharterStore {
  constructor(private readonly pool: PoolLike) {}

  /** Starts a new draft version — one past whatever the tenant's highest
   *  existing version is (0 if none exist yet). Content typically seeded
   *  from the raw onboarding-batch charterDraft the first time, or from a
   *  copy of the active version when the user "reopens" an installed
   *  Charter to edit it (master-plan-v2.md: "the user can reopen anytime"). */
  async createDraft(tenantId: string, content: Charter): Promise<CompanyCharter> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `INSERT INTO company_charters (tenant_id, version, status, content)
         VALUES (
           $1::uuid,
           COALESCE((SELECT MAX(version) FROM company_charters WHERE tenant_id = $1::uuid), 0) + 1,
           'draft',
           $2::jsonb
         )
         RETURNING ${SELECT_COLUMNS}`,
        [tenantId, JSON.stringify(content)],
      )) as unknown as { rows: CompanyCharterRow[] };
      return rowToCharter(result.rows[0]);
    });
  }

  /** Inline edits (the Charter editor) — only valid while the row is still
   *  a draft; an already-active or superseded version is immutable content,
   *  matching every other "accepted" record's shape in this codebase. */
  async updateDraft(tenantId: string, id: string, content: Charter): Promise<CompanyCharter | null> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `UPDATE company_charters
         SET content = $3::jsonb
         WHERE id = $1::uuid AND tenant_id = $2::uuid AND status = 'draft'
         RETURNING ${SELECT_COLUMNS}`,
        [id, tenantId, JSON.stringify(content)],
      )) as unknown as { rows: CompanyCharterRow[] };
      return result.rows[0] ? rowToCharter(result.rows[0]) : null;
    });
  }

  /** The handoff ceremony's actual state transition: demotes whatever was
   *  previously active to 'superseded' and installs `id` as the new active
   *  version with its generated cascade, atomically (both statements share
   *  withTenantScope's one transaction) — company_charters_one_active_per_
   *  tenant's partial unique index rejects this if that invariant would
   *  ever be violated, so a bug here fails loudly, not silently. */
  async accept(tenantId: string, id: string, cascade: PromptCascade): Promise<CompanyCharter | null> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      await client.query(
        `UPDATE company_charters SET status = 'superseded' WHERE tenant_id = $1::uuid AND status = 'active'`,
        [tenantId],
      );
      const result = (await client.query(
        `UPDATE company_charters
         SET status = 'active', cascade = $3::jsonb, installed_at = now()
         WHERE id = $1::uuid AND tenant_id = $2::uuid
         RETURNING ${SELECT_COLUMNS}`,
        [id, tenantId, JSON.stringify(cascade)],
      )) as unknown as { rows: CompanyCharterRow[] };
      return result.rows[0] ? rowToCharter(result.rows[0]) : null;
    });
  }

  /** Regeneration triggers that don't change Charter content (agent rename,
   *  autonomy change — ADR-024) update the ACTIVE version's cascade in
   *  place, without bumping version: the Charter's substance didn't change,
   *  only the derived prompts did. */
  async updateActiveCascade(tenantId: string, cascade: PromptCascade): Promise<CompanyCharter | null> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `UPDATE company_charters
         SET cascade = $2::jsonb
         WHERE tenant_id = $1::uuid AND status = 'active'
         RETURNING ${SELECT_COLUMNS}`,
        [tenantId, JSON.stringify(cascade)],
      )) as unknown as { rows: CompanyCharterRow[] };
      return result.rows[0] ? rowToCharter(result.rows[0]) : null;
    });
  }

  async getActive(tenantId: string): Promise<CompanyCharter | null> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT ${SELECT_COLUMNS} FROM company_charters WHERE tenant_id = $1::uuid AND status = 'active'`,
        [tenantId],
      )) as unknown as { rows: CompanyCharterRow[] };
      return result.rows[0] ? rowToCharter(result.rows[0]) : null;
    });
  }

  async getLatestDraft(tenantId: string): Promise<CompanyCharter | null> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT ${SELECT_COLUMNS} FROM company_charters
         WHERE tenant_id = $1::uuid AND status = 'draft'
         ORDER BY version DESC LIMIT 1`,
        [tenantId],
      )) as unknown as { rows: CompanyCharterRow[] };
      return result.rows[0] ? rowToCharter(result.rows[0]) : null;
    });
  }

  async get(tenantId: string, id: string): Promise<CompanyCharter | null> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT ${SELECT_COLUMNS} FROM company_charters WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        [id, tenantId],
      )) as unknown as { rows: CompanyCharterRow[] };
      return result.rows[0] ? rowToCharter(result.rows[0]) : null;
    });
  }

  /** Every version for a tenant, newest first — "the user can reopen
   *  anytime" (master-plan-v2.md) needs the history visible, not just the
   *  active row. */
  async listVersions(tenantId: string): Promise<CompanyCharter[]> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT ${SELECT_COLUMNS} FROM company_charters WHERE tenant_id = $1::uuid ORDER BY version DESC`,
        [tenantId],
      )) as unknown as { rows: CompanyCharterRow[] };
      return result.rows.map(rowToCharter);
    });
  }
}
