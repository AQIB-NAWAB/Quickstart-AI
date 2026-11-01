import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Pool } from "pg";

const MIGRATIONS: { version: string; file: string }[] = [
  { version: "001_agent_schema", file: "001_agent_schema.sql" },
  { version: "002_agent_versions", file: "002_agent_versions.sql" },
  { version: "003_agent_tools", file: "003_agent_tools.sql" },
  { version: "004_agent_voice_settings", file: "004_agent_voice_settings.sql" },
  { version: "005_custom_tools", file: "005_custom_tools.sql" },
  { version: "006_agent_canvas_graph", file: "006_agent_canvas_graph.sql" },
  { version: "007_agent_configuration", file: "007_agent_configuration.sql" },
  { version: "008_backfill_legacy_knowledge", file: "008_backfill_legacy_knowledge.sql" },
  { version: "009_agent_canary", file: "009_agent_canary.sql" },
  { version: "010_scheduled_releases", file: "010_scheduled_releases.sql" },
];

function resolveMigrationSql(file: string): string {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidate1 = join(here, "../../migrations", file);
  const candidate2 = join(here, "../migrations", file);
  const sqlPath = existsSync(candidate1) ? candidate1 : candidate2;
  return readFileSync(sqlPath, "utf8");
}

export async function runAgentMigrations(pool: Pool): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `);

  for (const migration of MIGRATIONS) {
    const { rows } = await pool.query<{ version: string }>(
      `SELECT version FROM schema_migrations WHERE version = $1`,
      [migration.version],
    );
    if (rows.length > 0) {
      continue;
    }

    const sql = resolveMigrationSql(migration.file);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query(`INSERT INTO schema_migrations (version) VALUES ($1)`, [
        migration.version,
      ]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }
}
