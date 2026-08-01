/**
 * Every BullMQ job payload in this system must carry a tenantId — security-
 * architecture.md Ring 1: "tenant ID on every queue job, cache entry, and
 * audit row." Job payload types extend this rather than redeclaring the
 * field so it can't be silently forgotten.
 */
export interface TenantJobPayload {
  tenantId: string;
}
