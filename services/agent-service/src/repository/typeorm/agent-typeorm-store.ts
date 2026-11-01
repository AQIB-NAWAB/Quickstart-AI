import { randomUUID } from "node:crypto";
import type { DataSource } from "typeorm";
import { insertAuditEntry } from "@quickstart/audit-writer";
import type { TenantContext } from "@quickstart/auth";
import {
  DEFAULT_AGENT_CONFIGURATION,
  DEFAULT_AGENT_VOICE_SETTINGS,
  normalizeAgentConfiguration,
} from "@quickstart/contracts";
import { AppError, ErrorCode } from "@quickstart/errors";
import { snapshotFromAgent } from "../../domain/types.js";
import { diffSnapshots } from "../../utils/version-diff.js";
import type { AgentStore, CreateAgentInput, UpdateAgentInput } from "../types.js";
import { AgentEntity, AgentVersionEntity } from "../entities/index.js";
import { toAgent, toAgentVersion } from "./mappers.js";

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "23505"
  );
}

const defaultChannels = { chat: true, voice: false };

export function createTypeOrmAgentStore(dataSource: DataSource): AgentStore {
  return {
    async createAgent(tenant: TenantContext, input: CreateAgentInput) {
      const now = new Date();
      const entity = dataSource.manager.create(AgentEntity, {
        id: randomUUID(),
        workspaceId: tenant.workspaceId,
        name: input.name.trim(),
        description: input.description ?? null,
        instructions: input.instructions ?? "",
        environment: input.environment ?? "draft",
        modelSettings: input.modelSettings ?? {},
        channels: input.channels ?? defaultChannels,
        tools: input.tools ?? [],
        voice: input.voice ?? { ...DEFAULT_AGENT_VOICE_SETTINGS },
        configuration: input.configuration ?? { ...DEFAULT_AGENT_CONFIGURATION },
        builderMode: input.builderMode ?? "legacy",
        draftGraph: input.draftGraph ?? null,
        graphSchemaVersion: 1,
        version: 1,
        productionVersionId: null,
        scheduledVersionId: null,
        scheduledPublishAt: null,
        canaryVersionId: null,
        canaryPercentage: 0,
        archivedAt: null,
        createdAt: now,
        updatedAt: now,
      });
      try {
        await dataSource.manager.save(entity);
        return toAgent(entity);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError({
            code: ErrorCode.CONFLICT,
            message: `Agent name '${input.name}' already exists in this workspace`,
          });
        }
        throw error;
      }
    },

    async listAgents(tenant: TenantContext, options = {}) {
      const limit = Math.min(Math.max(options.limit ?? 50, 1), 100);
      const query = dataSource.manager
        .createQueryBuilder(AgentEntity, "agent")
        .where("agent.workspace_id = :workspaceId", { workspaceId: tenant.workspaceId });
      if (!options.includeArchived) query.andWhere("agent.archived_at IS NULL");
      if (options.cursor) {
        const decoded = Buffer.from(options.cursor, "base64url").toString("utf8").split("|");
        if (decoded.length === 2 && decoded[0] && decoded[1]) {
          query.andWhere("(agent.created_at, agent.id) > (:createdAt, :id)", {
            createdAt: decoded[0],
            id: decoded[1],
          });
        }
      }
      const entities = await query
        .orderBy("agent.created_at", "ASC")
        .addOrderBy("agent.id", "ASC")
        .take(limit + 1)
        .getMany();
      const hasNext = entities.length > limit;
      const page = entities.slice(0, limit);
      const last = page.at(-1);
      return {
        items: page.map(toAgent),
        nextCursor:
          hasNext && last
            ? Buffer.from(`${last.createdAt.toISOString()}|${last.id}`).toString("base64url")
            : null,
      };
    },

    async getAgent(tenant: TenantContext, agentId: string) {
      const entity = await dataSource.manager.findOne(AgentEntity, {
        where: { id: agentId, workspaceId: tenant.workspaceId },
      });
      return entity ? toAgent(entity) : null;
    },

    async updateAgent(tenant: TenantContext, agentId: string, input: UpdateAgentInput) {
      const entity = await dataSource.manager.findOne(AgentEntity, {
        where: { id: agentId, workspaceId: tenant.workspaceId },
      });
      if (!entity) {
        throw new AppError({
          code: ErrorCode.NOT_FOUND,
          message: "Agent not found",
        });
      }
      if (entity.version !== input.expectedVersion) {
        throw new AppError({
          code: ErrorCode.CONFLICT,
          message: "Agent was modified by another request; reload and retry",
        });
      }

      if (input.name !== undefined) entity.name = input.name.trim();
      if (input.description !== undefined) entity.description = input.description;
      if (input.instructions !== undefined) entity.instructions = input.instructions;
      if (input.environment !== undefined) entity.environment = input.environment;
      if (input.modelSettings !== undefined) entity.modelSettings = input.modelSettings;
      if (input.channels !== undefined) entity.channels = input.channels;
      if (input.tools !== undefined) entity.tools = input.tools;
      if (input.voice !== undefined) entity.voice = input.voice;
      if (input.configuration !== undefined)
        entity.configuration = normalizeAgentConfiguration(input.configuration);
      if (input.builderMode !== undefined) entity.builderMode = input.builderMode;
      if (input.draftGraph !== undefined) entity.draftGraph = input.draftGraph;
      if (input.graphSchemaVersion !== undefined)
        entity.graphSchemaVersion = input.graphSchemaVersion;
      entity.version = entity.version + 1;
      entity.updatedAt = new Date();

      try {
        await dataSource.manager.save(entity);
        return toAgent(entity);
      } catch (error) {
        if (isUniqueViolation(error)) {
          throw new AppError({
            code: ErrorCode.CONFLICT,
            message: `Agent name '${input.name}' already exists in this workspace`,
          });
        }
        throw error;
      }
    },

    async updateGraph(
      tenant: TenantContext,
      agentId: string,
      graph: import("@quickstart/contracts").AgentGraph,
      expectedVersion: number,
      settings: import("@quickstart/contracts").GraphDraftSettings = {},
    ) {
      const entity = await dataSource.manager.findOne(AgentEntity, {
        where: { id: agentId, workspaceId: tenant.workspaceId },
      });
      if (!entity) {
        throw new AppError({
          code: ErrorCode.NOT_FOUND,
          message: "Agent not found",
        });
      }
      if (entity.version !== expectedVersion) {
        throw new AppError({
          code: ErrorCode.CONFLICT,
          message: "Draft was modified by another user or session; reload and retry",
        });
      }

      const values = {
        draftGraph: graph,
        builderMode: "canvas" as const,
        graphSchemaVersion: graph.schema_version,
        version: expectedVersion + 1,
        updatedAt: new Date(),
        ...(settings.instructions !== undefined ? { instructions: settings.instructions } : {}),
        ...(settings.model_settings ? { modelSettings: settings.model_settings } : {}),
        ...(settings.channels ? { channels: settings.channels } : {}),
        ...(settings.voice ? { voice: settings.voice } : {}),
      };
      const changed = await dataSource.manager.update(
        AgentEntity,
        { id: agentId, workspaceId: tenant.workspaceId, version: expectedVersion },
        values as Parameters<typeof dataSource.manager.update<AgentEntity>>[2],
      );
      if (!changed.affected)
        throw new AppError({
          code: ErrorCode.CONFLICT,
          message: "Draft changed while saving. Your local changes have been kept.",
        });
      const updated = await dataSource.manager.findOneByOrFail(AgentEntity, {
        id: agentId,
        workspaceId: tenant.workspaceId,
      });
      return toAgent(updated);
    },

    async deleteAgent(tenant: TenantContext, agentId: string) {
      const result = await dataSource.manager.delete(AgentEntity, {
        id: agentId,
        workspaceId: tenant.workspaceId,
      });
      return Boolean(result.affected && result.affected > 0);
    },

    async archiveAgent(tenant: TenantContext, agentId: string, archived: boolean) {
      const entity = await dataSource.manager.findOne(AgentEntity, {
        where: { id: agentId, workspaceId: tenant.workspaceId },
      });
      if (!entity) throw new AppError({ code: ErrorCode.NOT_FOUND, message: "Agent not found" });
      if (
        archived &&
        (entity.productionVersionId || entity.canaryVersionId || entity.scheduledVersionId)
      ) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "Unpublish the live release before archiving this agent",
        });
      }
      entity.archivedAt = archived ? new Date() : null;
      entity.updatedAt = new Date();
      await dataSource.manager.save(entity);
      return toAgent(entity);
    },

    async setCanary(tenant, agentId, versionId, percentage) {
      const entity = await dataSource.manager.findOne(AgentEntity, {
        where: { id: agentId, workspaceId: tenant.workspaceId },
      });
      if (!entity) throw new AppError({ code: ErrorCode.NOT_FOUND, message: "Agent not found" });
      if (versionId) {
        const version = await dataSource.manager.findOne(AgentVersionEntity, {
          where: { id: versionId, agentId, workspaceId: tenant.workspaceId },
        });
        if (!version)
          throw new AppError({ code: ErrorCode.NOT_FOUND, message: "Agent version not found" });
      }
      entity.canaryVersionId = versionId;
      entity.canaryPercentage = versionId ? percentage : 0;
      entity.updatedAt = new Date();
      await dataSource.manager.save(entity);
      return toAgent(entity);
    },

    async scheduleRelease(tenant, agentId, versionId, publishAt) {
      const entity = await dataSource.manager.findOne(AgentEntity, {
        where: { id: agentId, workspaceId: tenant.workspaceId },
      });
      if (!entity) throw new AppError({ code: ErrorCode.NOT_FOUND, message: "Agent not found" });
      const version = await dataSource.manager.findOne(AgentVersionEntity, {
        where: { id: versionId, workspaceId: tenant.workspaceId, agentId },
      });
      if (!version)
        throw new AppError({ code: ErrorCode.NOT_FOUND, message: "Agent version not found" });
      if (publishAt.getTime() <= Date.now()) {
        entity.productionVersionId = versionId;
        entity.scheduledVersionId = null;
        entity.scheduledPublishAt = null;
      } else {
        entity.scheduledVersionId = versionId;
        entity.scheduledPublishAt = publishAt;
      }
      entity.updatedAt = new Date();
      await dataSource.manager.save(entity);
      return toAgent(entity);
    },

    async applyDueSchedules(now = new Date()) {
      const entities = await dataSource.manager
        .createQueryBuilder(AgentEntity, "agent")
        .where("agent.scheduled_publish_at IS NOT NULL")
        .andWhere("agent.scheduled_publish_at <= :now", { now })
        .getMany();
      for (const entity of entities) {
        entity.productionVersionId = entity.scheduledVersionId;
        entity.scheduledVersionId = null;
        entity.scheduledPublishAt = null;
        entity.updatedAt = new Date();
        await dataSource.manager.save(entity);
      }
      return entities.length;
    },

    async publish(
      tenant: TenantContext,
      agentId: string,
      baseVersion: number,
      audit?: {
        requestId?: string;
        releaseNotes?: string;
        approval?: { approved: boolean; note?: string };
        completedChecklist?: string[];
      },
    ) {
      return await dataSource.transaction(async (manager) => {
        const entity = await manager.findOne(AgentEntity, {
          where: { id: agentId, workspaceId: tenant.workspaceId },
          lock: { mode: "pessimistic_write" },
        });
        if (!entity) {
          throw new AppError({
            code: ErrorCode.NOT_FOUND,
            message: "Agent not found",
          });
        }
        if (entity.version !== baseVersion) {
          throw new AppError({
            code: ErrorCode.CONFLICT,
            message: "Agent was modified by another request; reload and retry",
          });
        }

        const maxRow = await manager
          .createQueryBuilder(AgentVersionEntity, "v")
          .select("COALESCE(MAX(v.release_number), 0)", "max")
          .where("v.agent_id = :agentId AND v.workspace_id = :workspaceId", {
            agentId,
            workspaceId: tenant.workspaceId,
          })
          .getRawOne<{ max: string }>();
        const releaseNumber = Number(maxRow?.max ?? 0) + 1;

        const agent = toAgent(entity);
        const versionId = randomUUID();
        const versionEntity = manager.create(AgentVersionEntity, {
          id: versionId,
          workspaceId: tenant.workspaceId,
          agentId,
          releaseNumber,
          snapshot: snapshotFromAgent(agent, audit?.releaseNotes),
          releaseNotes: audit?.releaseNotes ?? null,
          createdBy: tenant.actorId,
          createdAt: new Date(),
        });
        await manager.save(versionEntity);

        entity.productionVersionId = versionId;
        entity.scheduledVersionId = null;
        entity.scheduledPublishAt = null;
        entity.canaryVersionId = null;
        entity.canaryPercentage = 0;
        entity.updatedAt = new Date();
        await manager.save(entity);

        if (audit?.requestId) {
          await insertAuditEntry((sql, params) => manager.query(sql, params), {
            workspaceId: tenant.workspaceId,
            actorUserId: tenant.actorId,
            action: "agent.published",
            targetType: "agent",
            targetId: agentId,
            requestId: audit.requestId,
            metadata: {
              agent_version_id: versionId,
              release_number: releaseNumber,
              base_version: baseVersion,
              approval: audit.approval?.approved === true,
              approval_note: audit.approval?.note?.slice(0, 500),
              completed_checklist: audit.completedChecklist ?? [],
            },
          });
        }

        return {
          version: toAgentVersion(versionEntity),
          agent: toAgent(entity),
        };
      });
    },

    async rollback(tenant: TenantContext, agentId: string, versionId: string) {
      return await dataSource.transaction(async (manager) => {
        const entity = await manager.findOne(AgentEntity, {
          where: { id: agentId, workspaceId: tenant.workspaceId },
          lock: { mode: "pessimistic_write" },
        });
        if (!entity) {
          throw new AppError({
            code: ErrorCode.NOT_FOUND,
            message: "Agent not found",
          });
        }

        const versionEntity = await manager.findOne(AgentVersionEntity, {
          where: { id: versionId, agentId, workspaceId: tenant.workspaceId },
        });
        if (!versionEntity) {
          throw new AppError({
            code: ErrorCode.NOT_FOUND,
            message: "Agent version not found",
          });
        }

        entity.productionVersionId = versionId;
        entity.scheduledVersionId = null;
        entity.scheduledPublishAt = null;
        entity.updatedAt = new Date();
        await manager.save(entity);

        return {
          version: toAgentVersion(versionEntity),
          agent: toAgent(entity),
        };
      });
    },

    async listVersions(tenant: TenantContext, agentId: string, limit = 50) {
      const agent = await dataSource.manager.findOne(AgentEntity, {
        where: { id: agentId, workspaceId: tenant.workspaceId },
      });
      if (!agent) {
        throw new AppError({
          code: ErrorCode.NOT_FOUND,
          message: "Agent not found",
        });
      }

      const entities = await dataSource.manager.find(AgentVersionEntity, {
        where: { agentId, workspaceId: tenant.workspaceId },
        order: { releaseNumber: "DESC" },
        take: limit,
      });
      return entities.map(toAgentVersion);
    },

    async getVersion(tenant: TenantContext, agentId: string, versionId: string) {
      const entity = await dataSource.manager.findOne(AgentVersionEntity, {
        where: { id: versionId, agentId, workspaceId: tenant.workspaceId },
      });
      return entity ? toAgentVersion(entity) : null;
    },

    async diffVersions(tenant: TenantContext, agentId: string, leftId: string, rightId: string) {
      const left = await dataSource.manager.findOne(AgentVersionEntity, {
        where: { id: leftId, agentId, workspaceId: tenant.workspaceId },
      });
      const right = await dataSource.manager.findOne(AgentVersionEntity, {
        where: { id: rightId, agentId, workspaceId: tenant.workspaceId },
      });
      if (!left || !right) {
        throw new AppError({
          code: ErrorCode.NOT_FOUND,
          message: "Agent version not found",
        });
      }
      return diffSnapshots(leftId, rightId, left.snapshot, right.snapshot);
    },
  };
}
