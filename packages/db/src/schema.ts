import { sql } from "drizzle-orm";
import { check, pgTable, text, timestamp, unique, uuid } from "drizzle-orm/pg-core";

/**
 * Every tenant-scoped table (tenant_members here, and any table added later
 * that carries a tenant_id column) MUST get a matching RLS policy in
 * migrations/0001_init.sql — see that file's header comment for the pattern.
 * Drizzle here defines shape/types only; RLS is managed via raw SQL because
 * it is a security control, not a convenience, and belongs in a
 * hand-reviewed migration rather than an auto-diffed one.
 */

export const tenants = pgTable("tenants", {
  id: uuid("id").primaryKey().defaultRandom(),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const tenantMembers = pgTable(
  "tenant_members",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => ({
    uniqueMembership: unique("tenant_members_tenant_id_user_id_key").on(table.tenantId, table.userId),
    roleCheck: check("tenant_members_role_check", sql`${table.role} in ('owner', 'admin', 'member')`),
  }),
);
