import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { insertAuditEntry } from "@quickstart/audit-writer";

export type SecretRow = {
  id: string;
  workspace_id: string;
  name: string;
  ciphertext: string;
  key_version: number;
  created_at: string;
  updated_at: string;
};

/** Projected row used for list responses — ciphertext never included */
export type SecretSummaryRow = {
  id: string;
  workspace_id: string;
  name: string;
  key_version: number;
  created_at: string;
  updated_at: string;
};

export type SecretAudit = {
  serviceActor?: boolean;
  actorUserId: string;
  requestId: string;
};

const FULL_COLUMNS = `id, workspace_id, name, ciphertext, key_version,
  created_at::text, updated_at::text`;

const SUMMARY_COLUMNS = `id, workspace_id, name, key_version,
  created_at::text, updated_at::text`;

export class SecretsRepository {
  constructor(private readonly pool: Pool) {}

  async listNames(workspaceId: string): Promise<SecretSummaryRow[]> {
    const result = await this.pool.query<SecretSummaryRow>(
      `SELECT ${SUMMARY_COLUMNS} FROM secrets
       WHERE workspace_id = $1
       ORDER BY name ASC`,
      [workspaceId],
    );
    return result.rows;
  }

  /** Full row including ciphertext — only for internal decrypt path */
  async getByName(workspaceId: string, name: string): Promise<SecretRow | null> {
    const result = await this.pool.query<SecretRow>(
      `SELECT ${FULL_COLUMNS} FROM secrets
       WHERE workspace_id = $1 AND name = $2`,
      [workspaceId, name],
    );
    return result.rows[0] ?? null;
  }

  /** Upsert: insert or overwrite ciphertext for an existing name */
  async upsert(input: {
    workspaceId: string;
    name: string;
    ciphertext: string;
    keyVersion: number;
    audit?: SecretAudit;
  }): Promise<SecretSummaryRow> {
    const id = randomUUID();
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<{ id: string }>(
        `SELECT id FROM secrets WHERE workspace_id = $1 AND name = $2`,
        [input.workspaceId, input.name],
      );
      const wasUpdate = Boolean(existing.rows[0]);
      const result = await client.query<SecretSummaryRow>(
        `INSERT INTO secrets (id, workspace_id, name, ciphertext, key_version)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (workspace_id, name)
         DO UPDATE SET ciphertext  = EXCLUDED.ciphertext,
                       key_version = EXCLUDED.key_version,
                       updated_at  = NOW()
         RETURNING ${SUMMARY_COLUMNS}`,
        [id, input.workspaceId, input.name, input.ciphertext, input.keyVersion],
      );
      const row = result.rows[0]!;
      if (input.audit) {
        await insertAuditEntry((sql, params) => client.query(sql, params), {
          workspaceId: input.workspaceId,
          actorUserId: input.audit.actorUserId,
          action: wasUpdate ? "secret.updated" : "secret.created",
          targetType: "secret",
          targetId: row.id,
          requestId: input.audit.requestId,
          metadata: {
            name: row.name,
            actor_type: input.audit.serviceActor ? "internal_service" : "user",
            key_version: row.key_version,
          },
        });
      }
      await client.query("COMMIT");
      return row;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  /** Rotate: update ciphertext and bump key_version for an existing row */
  async rotate(input: {
    workspaceId: string;
    name: string;
    newCiphertext: string;
    newKeyVersion: number;
    audit?: SecretAudit;
  }): Promise<SecretSummaryRow | null> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<SecretSummaryRow>(
        `UPDATE secrets
         SET ciphertext  = $3,
             key_version = $4,
             updated_at  = NOW()
         WHERE workspace_id = $1 AND name = $2
         RETURNING ${SUMMARY_COLUMNS}`,
        [input.workspaceId, input.name, input.newCiphertext, input.newKeyVersion],
      );
      const row = result.rows[0] ?? null;
      if (row && input.audit) {
        await insertAuditEntry((sql, params) => client.query(sql, params), {
          workspaceId: input.workspaceId,
          actorUserId: input.audit.actorUserId,
          action: "secret.rotated",
          targetType: "secret",
          targetId: row.id,
          requestId: input.audit.requestId,
          metadata: {
            name: row.name,
            actor_type: input.audit.serviceActor ? "internal_service" : "user",
            key_version: row.key_version,
          },
        });
      }
      await client.query("COMMIT");
      return row;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }

  async deleteByName(
    workspaceId: string,
    name: string,
    audit?: SecretAudit,
  ): Promise<boolean> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const existing = await client.query<SecretSummaryRow>(
        `SELECT ${SUMMARY_COLUMNS} FROM secrets WHERE workspace_id = $1 AND name = $2`,
        [workspaceId, name],
      );
      const row = existing.rows[0];
      if (!row) {
        await client.query("ROLLBACK");
        return false;
      }
      await client.query(`DELETE FROM secrets WHERE workspace_id = $1 AND name = $2`, [
        workspaceId,
        name,
      ]);
      if (audit) {
        await insertAuditEntry((sql, params) => client.query(sql, params), {
          workspaceId,
          actorUserId: audit.actorUserId,
          action: "secret.deleted",
          targetType: "secret",
          targetId: row.id,
          requestId: audit.requestId,
          metadata: {
            name: row.name,
            actor_type: audit.serviceActor ? "internal_service" : "user",
            key_version: row.key_version,
          },
        });
      }
      await client.query("COMMIT");
      return true;
    } catch (err) {
      await client.query("ROLLBACK");
      throw err;
    } finally {
      client.release();
    }
  }
}
