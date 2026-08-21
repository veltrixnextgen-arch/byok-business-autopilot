-- Vault durability (found during MVP-1 readiness audit): Vault
-- (packages/vault/src/vault.ts) stored every Brain/Hands key, and its
-- per-tenant Data Encryption Key (DekStore), in plain in-memory Maps —
-- every stored key was lost, silently, on every server restart or
-- redeploy. This closes that gap for both layers of the envelope
-- encryption: the DEK itself (encrypted by the KMS master key) and the
-- key records it encrypts (Brain/Hands material). Plaintext key material
-- NEVER reaches this schema — every material/ciphertext column here holds
-- only AES-256-GCM ciphertext; the AAD scope-binding (brainAad/handsAad,
-- crypto.ts) and SecretHandle's TTL-zeroing are unchanged by this move,
-- both live entirely in application code, not storage.

-- Envelope encryption's inner layer: one row per tenant, the DEK itself
-- encrypted by the KMS master key (Kms.encryptDek). Never the raw DEK —
-- decryptDek() is required to get anything usable back out, same as
-- before this was durable.
CREATE TABLE IF NOT EXISTS tenant_deks (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
  encrypted_dek_ciphertext BYTEA NOT NULL,
  encrypted_dek_iv BYTEA NOT NULL,
  encrypted_dek_auth_tag BYTEA NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE tenant_deks ENABLE ROW LEVEL SECURITY;
ALTER TABLE tenant_deks FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON tenant_deks;
CREATE POLICY tenant_isolation ON tenant_deks
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- One row per (tenant, role) — a Brain key's identity, matching Vault's
-- own in-memory Map<tenantId, Map<roleId, record>> exactly. storeBrainKey
-- REPLACES the row wholesale (new id, old material gone — Vault's
-- setBrainKey() has always fully overwritten the map entry, never kept
-- the old one reachable); rotateBrainKey/revokeBrainKey UPDATE the same
-- row in place, same id, matching Vault's own record-mutation behavior.
CREATE TABLE IF NOT EXISTS brain_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  material_ciphertext BYTEA,
  material_iv BYTEA,
  material_auth_tag BYTEA,
  masked_fingerprint TEXT NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, role_id)
);

ALTER TABLE brain_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE brain_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON brain_keys;
CREATE POLICY tenant_isolation ON brain_keys
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);

-- One row PER STORE CALL, never replaced — a Hands key's identity is its
-- own id, matching Vault's handsKeysById Map (keyed by id, not by scope)
-- exactly: re-storing for the same (tenant, subAgent, capabilityScope)
-- creates a brand-new row and only the "latest wins" lookup below moves
-- on; the old row stays reachable by its own id (still revocable) forever,
-- same as the in-memory version's documented "orphaned but present"
-- behavior.
CREATE TABLE IF NOT EXISTS hands_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  sub_agent_id TEXT NOT NULL,
  capability_scope TEXT NOT NULL,
  service TEXT NOT NULL,
  credential_kind TEXT NOT NULL DEFAULT 'opaque' CHECK (credential_kind IN ('opaque', 'oauth')),
  material_ciphertext BYTEA,
  material_iv BYTEA,
  material_auth_tag BYTEA,
  masked_fingerprint TEXT NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Backs resolveHandsKeyId's "latest non-revoked record for this exact
-- scope" lookup — the durable equivalent of Vault's in-memory
-- handsKeyIndex Map, but as a real query instead of a second structure to
-- keep in sync.
CREATE INDEX IF NOT EXISTS hands_keys_scope_lookup_idx
  ON hands_keys (tenant_id, sub_agent_id, capability_scope, created_at DESC)
  WHERE NOT revoked;

ALTER TABLE hands_keys ENABLE ROW LEVEL SECURITY;
ALTER TABLE hands_keys FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation ON hands_keys;
CREATE POLICY tenant_isolation ON hands_keys
  FOR ALL
  USING (tenant_id = current_setting('app.tenant_id', true)::uuid)
  WITH CHECK (tenant_id = current_setting('app.tenant_id', true)::uuid);
