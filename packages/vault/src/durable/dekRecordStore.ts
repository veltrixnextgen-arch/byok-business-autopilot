import { withTenantScope, type PoolLike } from "@byok/db";
import type { EncryptedBlob } from "../crypto.js";
import { isDevOrTestEnvironment } from "../env.js";

/**
 * Persistence for envelope encryption's inner layer — one encrypted DEK
 * per tenant (DekStore's own getOrCreateDek orchestrates the "get or
 * create" race handling; this interface is deliberately just two plain
 * operations, same shape as every other DurableXStore in this codebase).
 */
export interface DekRecordStore {
  get(tenantId: string): Promise<EncryptedBlob | null>;
  /** Inserts only if no row exists yet for this tenant — returns false
   *  (and does NOT overwrite) if one already does, so a caller that lost
   *  a create race knows to re-fetch via get() rather than trust its own
   *  freshly-generated DEK is the one now on file. */
  putIfAbsent(tenantId: string, blob: EncryptedBlob): Promise<boolean>;
  /** ADR-032: unconditionally overwrites the DEK for tenantId — unlike
   *  putIfAbsent, this DOES clobber an existing row, deliberately. Called
   *  only by DekStore.discardAndRecreateDek, only after the existing DEK
   *  has been confirmed undecryptable (its master key is gone) — at that
   *  point the old row is already permanently useless, so overwriting it
   *  loses nothing that wasn't already lost. */
  replace(tenantId: string, blob: EncryptedBlob): Promise<void>;
}

export class DevOnlyDekRecordStoreGuardError extends Error {}

/** Genuinely functional, single-process, reset on every restart — same
 *  ADR-026 guard pattern as InMemoryDurableApprovalStore/
 *  InMemoryDurableReservationStore: refusing to construct outside dev/test
 *  means a deployed environment that forgets to wire the Postgres store
 *  fails loudly at boot, not silently loses every key on the next
 *  restart the way the pre-durability Vault did. */
export class InMemoryDekRecordStore implements DekRecordStore {
  private readonly deks = new Map<string, EncryptedBlob>();

  constructor() {
    if (!isDevOrTestEnvironment()) {
      throw new DevOnlyDekRecordStoreGuardError(
        "InMemoryDekRecordStore cannot be constructed outside a dev or test environment — " +
          "use PostgresDekRecordStore for any deployed environment.",
      );
    }
  }

  async get(tenantId: string): Promise<EncryptedBlob | null> {
    return this.deks.get(tenantId) ?? null;
  }

  async putIfAbsent(tenantId: string, blob: EncryptedBlob): Promise<boolean> {
    if (this.deks.has(tenantId)) return false;
    this.deks.set(tenantId, blob);
    return true;
  }

  async replace(tenantId: string, blob: EncryptedBlob): Promise<void> {
    this.deks.set(tenantId, blob);
  }
}

interface DekRow {
  encrypted_dek_ciphertext: Buffer;
  encrypted_dek_iv: Buffer;
  encrypted_dek_auth_tag: Buffer;
}

function rowToBlob(row: DekRow): EncryptedBlob {
  return { ciphertext: row.encrypted_dek_ciphertext, iv: row.encrypted_dek_iv, authTag: row.encrypted_dek_auth_tag };
}

export class PostgresDekRecordStore implements DekRecordStore {
  constructor(private readonly pool: PoolLike) {}

  async get(tenantId: string): Promise<EncryptedBlob | null> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      const result = (await client.query(
        `SELECT encrypted_dek_ciphertext, encrypted_dek_iv, encrypted_dek_auth_tag
         FROM tenant_deks WHERE tenant_id = $1::uuid`,
        [tenantId],
      )) as unknown as { rows: DekRow[] };
      return result.rows[0] ? rowToBlob(result.rows[0]) : null;
    });
  }

  async putIfAbsent(tenantId: string, blob: EncryptedBlob): Promise<boolean> {
    return withTenantScope(this.pool, tenantId, async (client) => {
      // ON CONFLICT DO NOTHING, not DO UPDATE: a DEK, once real key
      // material has been encrypted with it, must never silently change
      // out from under existing records — the caller (DekStore) re-fetches
      // via get() when this returns false, rather than this method ever
      // overwriting the row that won the race.
      const result = (await client.query(
        `INSERT INTO tenant_deks (tenant_id, encrypted_dek_ciphertext, encrypted_dek_iv, encrypted_dek_auth_tag)
         VALUES ($1::uuid, $2, $3, $4)
         ON CONFLICT (tenant_id) DO NOTHING
         RETURNING tenant_id`,
        [tenantId, blob.ciphertext, blob.iv, blob.authTag],
      )) as unknown as { rows: unknown[] };
      return result.rows.length > 0;
    });
  }

  async replace(tenantId: string, blob: EncryptedBlob): Promise<void> {
    await withTenantScope(this.pool, tenantId, async (client) => {
      await client.query(
        `INSERT INTO tenant_deks (tenant_id, encrypted_dek_ciphertext, encrypted_dek_iv, encrypted_dek_auth_tag)
         VALUES ($1::uuid, $2, $3, $4)
         ON CONFLICT (tenant_id) DO UPDATE SET
           encrypted_dek_ciphertext = EXCLUDED.encrypted_dek_ciphertext,
           encrypted_dek_iv = EXCLUDED.encrypted_dek_iv,
           encrypted_dek_auth_tag = EXCLUDED.encrypted_dek_auth_tag`,
        [tenantId, blob.ciphertext, blob.iv, blob.authTag],
      );
    });
  }
}
