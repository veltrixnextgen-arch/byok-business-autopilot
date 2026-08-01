import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema.js";

export interface DbConnectionOptions {
  connectionString: string;
  max?: number;
}

export function createPool(options: DbConnectionOptions): Pool {
  return new Pool({ connectionString: options.connectionString, max: options.max ?? 10 });
}

export type Database = NodePgDatabase<typeof schema>;

export function createDb(pool: Pool): Database {
  return drizzle(pool, { schema });
}
