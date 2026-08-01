import { Pool } from "pg";
import { runMigrations } from "./migrate.js";

async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL is required (e.g. postgres://byok:byok_dev_password@localhost:5432/byok)");
  }

  const pool = new Pool({ connectionString });
  try {
    await runMigrations(pool);
    console.log("Migrations applied.");
  } finally {
    await pool.end();
  }
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
