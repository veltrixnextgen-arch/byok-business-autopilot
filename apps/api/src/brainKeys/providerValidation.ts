/** The four providers roles-and-api-key-guide.md Part 3 documents.
 *  Anthropic is the recommended default; DeepSeek is the "optional,
 *  advanced" Tier-1 alternative. Matches Vault.StoreBrainKeyInput's
 *  `provider` field (a bare string there — this is the narrower,
 *  validated set apps/api actually offers on the connect screen). */
export type BrainProvider = "anthropic" | "openai" | "google" | "deepseek";

export const BRAIN_PROVIDERS: readonly BrainProvider[] = ["anthropic", "openai", "google", "deepseek"];

export function isBrainProvider(value: string): value is BrainProvider {
  return (BRAIN_PROVIDERS as readonly string[]).includes(value);
}

/**
 * Live validation for a pasted Brain key (roles-and-api-key-guide.md Part
 * 3: "we run a fraction-of-a-cent validation call"). Each provider's own
 * free "list models" endpoint is used instead of a real generation call —
 * a genuine auth check against the key, at zero cost, not the literal
 * token-spending call the doc describes (ConnectScreen's own copy says
 * "we check your key works" rather than claiming a charge that doesn't
 * happen).
 *
 * No provider SDK dependency for any of the four — a models-list GET needs
 * nothing native fetch can't do. Anthropic deliberately does NOT reuse
 * apps/api's existing @anthropic-ai/sdk dependency (runExtractionBatch.ts):
 * the pinned SDK version (^0.32.1) predates its typed `.models` resource,
 * and its Node runtime shim calls `node-fetch` directly rather than
 * `globalThis.fetch` — invisible to this file's fetch-based tests, which
 * would silently hit the real network instead of the test double. Raw
 * fetch avoids both problems and keeps all four providers on one
 * consistent, easily-mocked mechanism.
 *
 * Matches Vault's `StoreBrainKeyInput.validate` shape exactly
 * ((plaintext: Buffer) => Promise<boolean>) so this can be passed straight
 * through as that hook.
 */
export async function validateBrainKey(provider: BrainProvider, plaintext: Buffer): Promise<boolean> {
  const apiKey = plaintext.toString("utf8");
  switch (provider) {
    case "anthropic":
      return validateAnthropicKey(apiKey);
    case "openai":
      return validateOpenAiKey(apiKey);
    case "google":
      return validateGoogleKey(apiKey);
    case "deepseek":
      return validateDeepSeekKey(apiKey);
  }
}

async function validateAnthropicKey(apiKey: string): Promise<boolean> {
  const res = await fetch("https://api.anthropic.com/v1/models?limit=1", {
    headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01" },
  });
  if (res.status === 401 || res.status === 403) return false;
  if (!res.ok) throw new Error(`Anthropic key validation call failed unexpectedly: ${res.status} ${res.statusText}`);
  return true;
}

async function validateOpenAiKey(apiKey: string): Promise<boolean> {
  const res = await fetch("https://api.openai.com/v1/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.status === 401 || res.status === 403) return false;
  if (!res.ok) throw new Error(`OpenAI key validation call failed unexpectedly: ${res.status} ${res.statusText}`);
  return true;
}

async function validateGoogleKey(apiKey: string): Promise<boolean> {
  // Generative Language API reports an invalid/malformed key as 400 (its
  // own error body reads "API key not valid"), not 401/403 — this
  // endpoint takes no other input that could produce a 400, so a 400
  // here can only mean the key itself.
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models?key=${encodeURIComponent(apiKey)}`);
  if (res.status === 400 || res.status === 401 || res.status === 403) return false;
  if (!res.ok) throw new Error(`Google key validation call failed unexpectedly: ${res.status} ${res.statusText}`);
  return true;
}

async function validateDeepSeekKey(apiKey: string): Promise<boolean> {
  // OpenAI-compatible API shape (roles-and-api-key-guide.md 3D).
  const res = await fetch("https://api.deepseek.com/models", {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (res.status === 401 || res.status === 403) return false;
  if (!res.ok) throw new Error(`DeepSeek key validation call failed unexpectedly: ${res.status} ${res.statusText}`);
  return true;
}
