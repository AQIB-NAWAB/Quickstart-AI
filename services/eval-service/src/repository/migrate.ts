import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), "../../migrations");
const MIGRATION_FILES = [
  "001_eval.sql",
  "002_eval_suite_v2.sql",
  "003_eval_gates_and_unavailability.sql",
  "004_eval_run_cursor_index.sql",
] as const;

export async function runEvalMigrations(pool: Pool): Promise<void> {
  for (const file of MIGRATION_FILES) {
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    await pool.query(sql);
  }
}
