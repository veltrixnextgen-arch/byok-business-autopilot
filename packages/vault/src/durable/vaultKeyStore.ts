import { withTenantScope, type PoolLike } from "@byok/db";
import type { EncryptedBlob } from "../crypto.js";
import { isDevOrTestEnvironment } from "../env.js";
import type { BrainKeyRecord, HandsKeyRecord } from "../types.js";

/**
 * Persistence for Vault's key records (Brain + Hands). Two different
 * "replace" semantics on purpose, matching Vault's pre-durability
 * in-memory Maps exactly:
 *  - Brain keys: one row per (tenant, role) — storeBrainKey REPLACES the
 *    row wholesale (new id, old material gone); rotate/revoke UPDATE the
 *    same row in place.
 *  - Hands keys: one row PER STORE CALL, keyed by its own id — re-storing
 *    for the same scope never touches the old row (it stays reachable by
 *    id, still revocable, forever); only the "latest wins" lookup below
 *    moves on to the new one.
 */
export interface VaultKeyStore {
  getBrainKey(tenantId: string, roleId: string): Promise<BrainKeyRecord | null>;
  /** Full replace — a fresh record for a (tenant, role) that already has
   *  one overwrites it entirely, old id and old material gone. */
  putBrainKey(record: BrainKeyRecord): Promise<void>;
  /** In-place field update — same id, used by rotate/revoke. */
  updateBrainKey(record: BrainKeyRecord): Promise<void>;

  getHandsKeyById(tenantId: string, keyId: string): Promise<HandsKeyRecord | null>;
  /** Always inserts a new row — never replaces an existing one. */
  putHandsKey(record: HandsKeyRecord): Promise<void>;
  /** In-place field update — same id, used by rotate/revoke/OAuth refresh. */
  updateHandsKey(record: HandsKeyRecord): Promise<void>;
  /** "Latest wins" lookup — the newest non-revoked record for this exact
   *  (tenant, subAgent, capabilityScope). */
  resolveHandsKeyId(tenantId: string, subAgentId: string, capabilityScope: string): Promise<string | null>;
}

export class DevOnlyVaultKeyStoreGuardError extends Error {}

/** Genuinely functional, single-process, reset on every restart — same
 *  ADR-026 guard pattern as every other in-memory durable-store fallback
 *  in this codebase. */
export class InMemoryVaultKeyStore implements VaultKeyStore {
  private readonly brainKeysByTenant = new Map<string, Map<string, BrainKeyRecord>>();
  private readonly handsKeysById = new Map<string, HandsKeyRecord>();
  private readonly handsKeyIndex = new Map<string, string>();

  constructor() {
    if (!isDevOrTestEnvironment()) {
      throw new DevOnlyVaultKeyStoreGuardError(
        "InMemoryVaultKeyStore cannot be constructed outside a dev or test environment — " +
          "use PostgresVaultKeyStore for any deployed environment.",
      );
    }
  }

  private static handsIndexKey(tenantId: string, subAgentId: string, capabilityScope: string): string {
    return `${tenantId}::${subAgentId}::${capabilityScope}`;
  }

  async getBrainKey(tenantId: string, roleId: string): Promise<BrainKeyRecord | null> {
    return this.brainKeysByTenant.get(tenantId)?.get(roleId) ?? null;
  }

  async putBrainKey(record: BrainKeyRecord): Promise<void> {
    let byRole = this.brainKeysByTenant.get(record.tenantId);
    if (!byRole) {
      byRole = new Map();
      this.brainKeysByTenant.set(record.tenantId, byRole);
    }
    byRole.set(record.roleId, record);
  }

  async updateBrainKey(record: BrainKeyRecord): Promise<void> {
    await this.putBrainKey(record); // same object, same id — overwrite is equivalent to in-place update here
  }

  async getHandsKeyById(_tenantId: string, keyId: string): Promise<HandsKeyRecord | null> {
    return this.handsKeysById.get(keyId) ?? null;
  }

  async putHandsKey(record: HandsKeyRecord): Promise<void> {
    this.handsKeysById.set(record.id, record);
    this.handsKeyIndex.set(InMemoryVaultKeyStore.handsIndexKey(record.tenantId, record.subAgentId, record.capabilityScope), record.id);
  }

  async updateHandsKey(record: HandsKeyRecord): Promise<void> {
    this.handsKeysById.set(record.id, record); // same id — the index already points here
  }

  async resolveHandsKeyId(tenantId: string, subAgentId: string, capabilityScope: string): Promise<string | null> {
    const keyId = this.handsKeyIndex.get(InMemoryVaultKeyStore.handsIndexKey(tenantId, subAgentId, capabilityScope));
    const record = keyId ? this.handsKeysById.get(keyId) : undefined;
    return record && !record.revoked ? record.id : null;
  }
}

interface BrainKeyRow {
  id: string;
  tenant_id: string;
  role_id: string;
  provider: string;
  material_ciphertext: Buffer | null;
  material_iv: Buffer | null;
  material_auth_tag: Buffer | null;
  masked_fingerprint: string;
  revoked: boolean;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

function materialFromRow(row: { material_ciphertext: Buffer | null; material_iv: Buffer | null; material_auth_tag: Buffer | null }): EncryptedBlob | null {
  return row.material_ciphertext && row.material_iv && row.material_auth_tag
    ? { ciphertext: row.material_ciphertext, iv: row.material_iv, authTag: row.material_auth_tag }
    : null;
}

function rowToBrainKey(row: BrainKeyRow): BrainKeyRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: "brain",
    roleId: row.role_id,
    provider: row.provider,
    material: materialFromRow(row),
    maskedFingerprint: row.masked_fingerprint,
    revoked: row.revoked,
    revokedAt: row.revoked_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

interface HandsKeyRow {
  id: string;
  tenant_id: string;
  sub_agent_id: string;
  capability_scope: string;
  service: string;
  credential_kind: "opaque" | "oauth";
  material_ciphertext: Buffer | null;
  material_iv: Buffer | null;
  material_auth_tag: Buffer | null;
  masked_fingerprint: string;
  revoked: boolean;
  revoked_at: string | null;
  created_at: string;
  updated_at: string;
}

function rowToHandsKey(row: HandsKeyRow): HandsKeyRecord {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    type: "hands",
    subAgentId: row.sub_agent_id,
    capabilityScope: row.capability_scope,
    service: row.service,
    credentialKind: row.credential_kind,
    material: materialFromRow(row),
    maskedFingerprint: row.masked_fingerprint,
    revoked: row.revoked,
    revokedAt: row.revoked_at ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class PostgresVaultKeyStore implements VaultKeyStore {
  constructor(private readonly pool: PoolLike) {}

  async getBrainKey(tenantId: string, roleId: string): Promise<BrainKeyRecord | null> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT id, tenant_id, role_id, provider, material_ciphertext, material_iv, material_auth_tag,
                masked_fingerprint, revoked, revoked_at, created_at, updated_at
         FROM brain_keys WHERE tenant_id = $1::uuid AND role_id = $2`,
        [tenantId, roleId],
      )) as unknown as { rows: BrainKeyRow[] };
      return result.rows[0] ? rowToBrainKey(result.rows[0]) : null;
    });
  }

  async putBrainKey(record: BrainKeyRecord): Promise<void> {
    await withTenantScope(this.pool, record.tenantId, async (client) => {
      // Wholesale replace, including id — matches Vault's own setBrainKey()
      // overwrite-the-map-entry semantics exactly: a fresh store for a
      // (tenant, role) that already has a record makes the OLD id and
      // material genuinely unreachable, not just superseded.
      await client.query(
        `INSERT INTO brain_keys (id, tenant_id, role_id, provider, material_ciphertext, material_iv, material_auth_tag,
                                  masked_fingerprint, revoked, revoked_at, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         ON CONFLICT (tenant_id, role_id) DO UPDATE SET
           id = EXCLUDED.id, provider = EXCLUDED.provider,
           material_ciphertext = EXCLUDED.material_ciphertext, material_iv = EXCLUDED.material_iv, material_auth_tag = EXCLUDED.material_auth_tag,
           masked_fingerprint = EXCLUDED.masked_fingerprint, revoked = EXCLUDED.revoked, revoked_at = EXCLUDED.revoked_at,
           updated_at = EXCLUDED.updated_at`,
        [
          record.id,
          record.tenantId,
          record.roleId,
          record.provider,
          record.material?.ciphertext ?? null,
          record.material?.iv ?? null,
          record.material?.authTag ?? null,
          record.maskedFingerprint,
          record.revoked,
          record.revokedAt ?? null,
          record.createdAt,
          record.updatedAt,
        ],
      );
    });
  }

  async updateBrainKey(record: BrainKeyRecord): Promise<void> {
    await withTenantScope(this.pool, record.tenantId, async (client) => {
      await client.query(
        `UPDATE brain_keys SET
           material_ciphertext = $3, material_iv = $4, material_auth_tag = $5,
           masked_fingerprint = $6, revoked = $7, revoked_at = $8, updated_at = $9
         WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        [
          record.id,
          record.tenantId,
          record.material?.ciphertext ?? null,
          record.material?.iv ?? null,
          record.material?.authTag ?? null,
          record.maskedFingerprint,
          record.revoked,
          record.revokedAt ?? null,
          record.updatedAt,
        ],
      );
    });
  }

  async getHandsKeyById(tenantId: string, keyId: string): Promise<HandsKeyRecord | null> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT id, tenant_id, sub_agent_id, capability_scope, service, credential_kind,
                material_ciphertext, material_iv, material_auth_tag, masked_fingerprint, revoked, revoked_at, created_at, updated_at
         FROM hands_keys WHERE tenant_id = $1::uuid AND id = $2::uuid`,
        [tenantId, keyId],
      )) as unknown as { rows: HandsKeyRow[] };
      return result.rows[0] ? rowToHandsKey(result.rows[0]) : null;
    });
  }

  async putHandsKey(record: HandsKeyRecord): Promise<void> {
    await withTenantScope(this.pool, record.tenantId, async (client) => {
      await client.query(
        `INSERT INTO hands_keys (id, tenant_id, sub_agent_id, capability_scope, service, credential_kind,
                                  material_ciphertext, material_iv, material_auth_tag, masked_fingerprint, revoked, revoked_at, created_at, updated_at)
         VALUES ($1::uuid, $2::uuid, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          record.id,
          record.tenantId,
          record.subAgentId,
          record.capabilityScope,
          record.service,
          record.credentialKind,
          record.material?.ciphertext ?? null,
          record.material?.iv ?? null,
          record.material?.authTag ?? null,
          record.maskedFingerprint,
          record.revoked,
          record.revokedAt ?? null,
          record.createdAt,
          record.updatedAt,
        ],
      );
    });
  }

  async updateHandsKey(record: HandsKeyRecord): Promise<void> {
    await withTenantScope(this.pool, record.tenantId, async (client) => {
      await client.query(
        `UPDATE hands_keys SET
           material_ciphertext = $3, material_iv = $4, material_auth_tag = $5,
           masked_fingerprint = $6, revoked = $7, revoked_at = $8, updated_at = $9
         WHERE id = $1::uuid AND tenant_id = $2::uuid`,
        [
          record.id,
          record.tenantId,
          record.material?.ciphertext ?? null,
          record.material?.iv ?? null,
          record.material?.authTag ?? null,
          record.maskedFingerprint,
          record.revoked,
          record.revokedAt ?? null,
          record.updatedAt,
        ],
      );
    });
  }

  async resolveHandsKeyId(tenantId: string, subAgentId: string, capabilityScope: string): Promise<string | null> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT id FROM hands_keys
         WHERE tenant_id = $1::uuid AND sub_agent_id = $2 AND capability_scope = $3 AND NOT revoked
         ORDER BY created_at DESC LIMIT 1`,
        [tenantId, subAgentId, capabilityScope],
      )) as unknown as { rows: Array<{ id: string }> };
      return result.rows[0]?.id ?? null;
    });
  }
}
