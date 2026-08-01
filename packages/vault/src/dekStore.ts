import type { EncryptedBlob } from "./crypto.js";
import { generateKey } from "./crypto.js";
import type { Kms } from "./kms.js";

// Envelope encryption's inner layer: one Data Encryption Key (DEK) per
// tenant, generated once, encrypted at rest by the KMS master key. Every
// key record for that tenant is encrypted with the (decrypted) DEK, never
// directly with the master key — the master key only ever touches DEKs.
export class DekStore {
  private readonly encryptedDeks = new Map<string, EncryptedBlob>();

  constructor(private readonly kms: Kms) {}

  async getOrCreateDek(tenantId: string): Promise<Buffer> {
    const existing = this.encryptedDeks.get(tenantId);
    if (existing) return this.kms.decryptDek(existing);

    const dek = generateKey();
    const encrypted = await this.kms.encryptDek(dek);
    this.encryptedDeks.set(tenantId, encrypted);
    return dek;
  }
}
