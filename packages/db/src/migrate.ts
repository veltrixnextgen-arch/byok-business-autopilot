import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export interface QueryablePool {
  query(text: string): Promise<unknown>;
}

const MIGRATIONS_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "migrations");

// Applied in order; append new files here as they're added, never reorder
// or edit an already-applied one — write a new migration instead.
const MIGRATION_FILES = ["0001_init.sql", "0002_durable_storage.sql"];

export async function runMigrations(pool: QueryablePool): Promise<void> {
  for (const file of MIGRATION_FILES) {
    const sql = await readFile(path.join(MIGRATIONS_DIR, file), "utf8");
    await pool.query(sql);
  }
}

export function migrationFiles(): readonly string[] {
  return MIGRATION_FILES;
}

export function migrationsDir(): string {
  return MIGRATIONS_DIR;
}
