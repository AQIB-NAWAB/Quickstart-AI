import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { Pool } from "pg";

export const MIGRATIONS = [
  // Keep applied migrations immutable; add fixes as new versions.
  {
    version: "001_lead_generation",
    sql: () => readFileSync(new URL("../migrations/001_lead_generation.sql", import.meta.url), "utf8"),
  },
  {
    version: "002_configurable_leads_connectors",
    sql: () => readFileSync(new URL("../migrations/002_configurable_leads_connectors.sql", import.meta.url), "utf8"),
  },
  {
    version: "003_entities_criteria_and_crm",
    sql: () => readFileSync(new URL("../migrations/003_entities_criteria_and_crm.sql", import.meta.url), "utf8"),
  },
  {
    version: "004_schedule_leases",
    sql: () => readFileSync(new URL("../migrations/004_schedule_leases.sql", import.meta.url), "utf8"),
  },
  {
    version: "005_source_runs",
    sql: () => readFileSync(new URL("../migrations/005_source_runs.sql", import.meta.url), "utf8"),
  },
];

export const migrationSql = () => MIGRATIONS[0].sql();

export async function migrate(pool: Pool) {
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await c.query("SELECT pg_advisory_xact_lock(3019)");
    await c.query(
      "CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,applied_at timestamptz NOT NULL DEFAULT now())",
    );
    for (const m of MIGRATIONS) {
      if (
        !(await c.query("SELECT 1 FROM schema_migrations WHERE version=$1", [m.version])).rows.length
      ) {
        await c.query(m.sql());
        await c.query("INSERT INTO schema_migrations(version) VALUES($1)", [m.version]);
      }
    }
    await c.query("COMMIT");
  } catch (e) {
    await c.query("ROLLBACK");
    throw e;
  } finally {
    c.release();
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ?? "postgresql://quickstart:quickstart@127.0.0.1:5433/quickstart",
  });
  void migrate(pool)
    .then(() => console.log("Lead generation migrations complete."))
    .catch((e) => {
      console.error(e.message);
      process.exitCode = 1;
    })
    .finally(() => pool.end());
}
