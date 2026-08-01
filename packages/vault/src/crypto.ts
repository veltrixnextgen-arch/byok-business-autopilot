import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

// AES-256-GCM everywhere: authenticated encryption, and critically, an AAD
// (additional authenticated data) slot. Binding scope metadata (a Hands
// key's subAgentId+capabilityScope, a Brain key's roleId+provider) into the
// AAD means the binding is cryptographic, not just an application-level
// if-check — decrypt() throws if the caller's claimed scope doesn't match
// what was used at encryption time, even if they somehow obtained the raw
// ciphertext another way (DB access, backup, a bug elsewhere).
const ALGORITHM = "aes-256-gcm";
const KEY_LENGTH_BYTES = 32; // AES-256
const IV_LENGTH_BYTES = 12; // GCM-recommended

export interface EncryptedBlob {
  ciphertext: Buffer;
  iv: Buffer;
  authTag: Buffer;
}

export function generateKey(): Buffer {
  return randomBytes(KEY_LENGTH_BYTES);
}

export function encrypt(plaintext: Buffer, key: Buffer, aad?: Buffer): EncryptedBlob {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  if (aad) cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return { ciphertext, iv, authTag };
}

// Throws (GCM auth-tag verification failure) if `key` is wrong, the
// ciphertext was tampered with, OR `aad` doesn't match what was supplied at
// encryption time. That last case is the scope-binding enforcement.
export function decrypt(blob: EncryptedBlob, key: Buffer, aad?: Buffer): Buffer {
  const decipher = createDecipheriv(ALGORITHM, key, blob.iv);
  if (aad) decipher.setAAD(aad);
  decipher.setAuthTag(blob.authTag);
  return Buffer.concat([decipher.update(blob.ciphertext), decipher.final()]);
}

/** Canonical AAD for a Brain key: bound to role + provider. */
export function brainAad(roleId: string, provider: string): Buffer {
  return Buffer.from(`brain:${roleId}:${provider}`, "utf8");
}

/** Canonical AAD for a Hands key: bound to ONE sub-agent + ONE capability
 *  scope, per ADR-002 and T8 (an agent can never enumerate or borrow
 *  another agent's Hands). */
export function handsAad(subAgentId: string, capabilityScope: string): Buffer {
  return Buffer.from(`hands:${subAgentId}:${capabilityScope}`, "utf8");
}

export function zeroBuffer(buffer: Buffer): void {
  buffer.fill(0);
}
