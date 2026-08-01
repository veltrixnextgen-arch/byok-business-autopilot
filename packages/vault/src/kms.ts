import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { decrypt, encrypt, generateKey, type EncryptedBlob } from "./crypto.js";

// The KMS holds ONE master key that encrypts per-tenant DEKs (envelope
// encryption's outer layer). Swappable by design: LocalKms for dev, a real
// AWS/GCP KMS-backed implementation for production behind the same
// interface — the vault's own code never changes when that swap happens.
export interface Kms {
  encryptDek(dek: Buffer): Promise<EncryptedBlob>;
  decryptDek(blob: EncryptedBlob): Promise<Buffer>;
}

// Dev-only. The master key lives in a local file that MUST be gitignored
// (see .gitignore: .local-kms/) — generated on first run if missing, never
// checked in, never logged. This is explicitly not production-safe: no
// rotation, no HSM, no access audit on the master key itself. CloudKms
// below is the production swap.
export class LocalKms implements Kms {
  private readonly masterKey: Buffer;

  constructor(keyFilePath: string) {
    this.masterKey = LocalKms.loadOrCreate(keyFilePath);
  }

  private static loadOrCreate(path: string): Buffer {
    if (existsSync(path)) {
      const key = readFileSync(path);
      if (key.length !== 32) {
        throw new Error(`LocalKms master key at ${path} is malformed (expected 32 bytes, got ${key.length}).`);
      }
      return key;
    }
    const key = generateKey();
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, key, { mode: 0o600 });
    return key;
  }

  async encryptDek(dek: Buffer): Promise<EncryptedBlob> {
    return encrypt(dek, this.masterKey);
  }

  async decryptDek(blob: EncryptedBlob): Promise<Buffer> {
    return decrypt(blob, this.masterKey);
  }
}

export interface CloudKmsConfig {
  provider: "aws-kms" | "gcp-kms";
  /** ARN (AWS) or resource name (GCP) of the customer master key. */
  keyResourceId: string;
  region?: string;
}

// Stub shaped for the real thing so swapping LocalKms -> CloudKms in
// production is a config change, not a rewrite: same Kms interface, same
// callers, same vault code. Wire in @aws-sdk/client-kms or
// @google-cloud/kms here when a real cloud account exists — every method
// below is exactly where that SDK call goes.
export class CloudKms implements Kms {
  constructor(private readonly config: CloudKmsConfig) {}

  async encryptDek(_dek: Buffer): Promise<EncryptedBlob> {
    throw new Error(
      `CloudKms(${this.config.provider}) is a stub — not implemented. ` +
        `Wire in the real KMS Encrypt API call here before using in production.`,
    );
  }

  async decryptDek(_blob: EncryptedBlob): Promise<Buffer> {
    throw new Error(
      `CloudKms(${this.config.provider}) is a stub — not implemented. ` +
        `Wire in the real KMS Decrypt API call here before using in production.`,
    );
  }
}
