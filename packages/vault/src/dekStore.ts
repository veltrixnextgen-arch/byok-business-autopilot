import { generateKey } from "./crypto.js";
import { InMemoryDekRecordStore, type DekRecordStore } from "./durable/dekRecordStore.js";
import type { Kms } from "./kms.js";

/** ADR-032: thrown by getOrCreateDek when a tenant's stored DEK exists
 *  but can no longer be decrypted — the master key that encrypted it is
 *  gone (a KMS rotation, most likely; also a real risk for a compromised-
 *  key rotation or a provider migration). Every key encrypted under that
 *  DEK is, at that point, already permanently unrecoverable; this error
 *  exists so each caller can decide what "recover" honestly means for
 *  its own context — see getOrCreateDek's own comment for why that
 *  decision does NOT belong inside this method itself. */
export class DekUndecryptableError extends Error {}

// Envelope encryption's inner layer: one Data Encryption Key (DEK) per
// tenant, generated once, encrypted at rest by the KMS master key. Every
// key record for that tenant is encrypted with the (decrypted) DEK, never
// directly with the master key — the master key only ever touches DEKs.
//
// `store` defaults to an in-memory Map for tests/local dev without a real
// Postgres connection handy — durableTrustCore.ts (and devTrustCore.ts,
// which also has a real pool) pass PostgresDekRecordStore explicitly. See
// durable/dekRecordStore.ts's own module comment for why persisting the
// DEK is not optional once the key RECORDS it decrypts are durable too:
// without it, every previously-stored key becomes permanently
// undecryptable the moment the process restarts and a fresh DEK is
// generated in its place — the encrypted material would still be sitting
// in Postgres, silently unusable.
export class DekStore {
  constructor(
    private readonly kms: Kms,
    private readonly store: DekRecordStore = new InMemoryDekRecordStore(),
  ) {}

  // Restart-mid-write safety: a crash between this DEK insert and the
  // caller's own key-record write (Vault.storeBrainKey/storeHandsKey) never
  // leaves a partial record — each is its own single Postgres statement,
  // so either fully commits or doesn't happen at all. The worst case is an
  // orphaned-but-harmless DEK row with no key record using it yet, which
  // the next getOrCreateDek call for this tenant just reuses via the get()
  // branch above — see durable/vaultDurability.itest.ts's own test for the
  // proof.
  //
  // ADR-032: throws DekUndecryptableError (never a raw, unclassified
  // crypto exception) if the existing DEK can't be decrypted under the
  // currently-configured master key — logged loudly here (a tenant's
  // keys becoming unreadable belongs in an audit trail), but deliberately
  // does NOT discard/recreate the DEK itself. That decision differs by
  // caller: a write path (Vault.storeBrainKey/storeHandsKey/rotate*)
  // catches this and calls discardAndRecreateDek so the tenant can
  // re-enter their key; a read path (decryptBrainKey/decryptHandsKey/
  // verifyBrainKeyDecryptable) must NOT recreate anything on a passive
  // read — doing so would be a surprising side effect that doesn't even
  // help, since the EXISTING material was encrypted under the dead DEK
  // specifically, and a fresh one can't read it either.
  async getOrCreateDek(tenantId: string): Promise<Buffer> {
    const existing = await this.store.get(tenantId);
    if (existing) return this.decryptOrThrow(tenantId, existing);

    const dek = generateKey();
    const encrypted = await this.kms.encryptDek(dek);
    const inserted = await this.store.putIfAbsent(tenantId, encrypted);
    if (inserted) return dek;

    // Lost a concurrent create race — some other caller's DEK is now the
    // one on file. Use theirs, not the one we just generated (which was
    // never persisted and must not be used to encrypt anything).
    const winner = await this.store.get(tenantId);
    if (!winner) {
      throw new Error(`DEK for tenant "${tenantId}" vanished between putIfAbsent and get — this should be impossible.`);
    }
    return this.decryptOrThrow(tenantId, winner);
  }

  /** ADR-032: called only by a write path, only after catching
   *  DekUndecryptableError from getOrCreateDek above — discards the dead
   *  DEK (it can never be decrypted again regardless) and replaces it
   *  with a fresh one so the tenant's freshly-entered key can be
   *  encrypted and stored under it. Never call this from a read path. */
  async discardAndRecreateDek(tenantId: string): Promise<Buffer> {
    const dek = generateKey();
    const encrypted = await this.kms.encryptDek(dek);
    await this.store.replace(tenantId, encrypted);
    console.error(
      `[DekStore] Discarded the undecryptable DEK for tenant "${tenantId}" and created a fresh one. ` +
        `Every key previously stored under the old DEK is now permanently unrecoverable and will need reconnecting.`,
    );
    return dek;
  }

  private async decryptOrThrow(tenantId: string, blob: import("./crypto.js").EncryptedBlob): Promise<Buffer> {
    try {
      return await this.kms.decryptDek(blob);
    } catch (err) {
      console.error(
        `[DekStore] DEK for tenant "${tenantId}" could not be decrypted — the KMS master key that encrypted it ` +
          `is no longer available. Every key stored under it is unrecoverable.`,
        err,
      );
      throw new DekUndecryptableError(
        `DEK for tenant "${tenantId}" could not be decrypted — the master key that encrypted it is no longer available.`,
      );
    }
  }
}
