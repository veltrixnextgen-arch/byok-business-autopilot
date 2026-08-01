import { zeroBuffer } from "./crypto.js";
import { SecretExpiredError } from "./types.js";

const REDACTED = "[SecretHandle: redacted]";

// Decrypt never returns a bare string or Buffer — it returns one of these.
// Plaintext is only reachable inside `use()`, and the buffer is zeroed the
// moment `use()` returns (success or throw) OR the TTL backstop fires,
// whichever is first. toString/toJSON/util.inspect all redact, so an
// accidental `console.log(handle)` or `JSON.stringify(handle)` anywhere in
// the codebase cannot leak the secret — Section 3: "never written to disk,
// logs, traces, or model context."
export class SecretHandle {
  private buffer: Buffer | null;
  private readonly timer: ReturnType<typeof setTimeout>;

  constructor(plaintext: Buffer, ttlMs: number) {
    this.buffer = plaintext;
    this.timer = setTimeout(() => this.zero(), ttlMs);
    this.timer.unref?.();
  }

  async use<T>(fn: (plaintext: Buffer) => T | Promise<T>): Promise<T> {
    if (!this.buffer) {
      throw new SecretExpiredError("Secret handle has expired or was already used/zeroed.");
    }
    try {
      return await fn(this.buffer);
    } finally {
      this.zero();
    }
  }

  zero(): void {
    if (this.buffer) {
      zeroBuffer(this.buffer);
      this.buffer = null;
    }
    clearTimeout(this.timer);
  }

  get isZeroed(): boolean {
    return this.buffer === null;
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  [Symbol.for("nodejs.util.inspect.custom")](): string {
    return REDACTED;
  }
}
