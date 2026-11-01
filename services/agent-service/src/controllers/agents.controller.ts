import {
  requestIdFromResponse,
  sendPlatformJson,
  type RequestHandler,
} from "@quickstart/http-server";
import {
  createDefaultAgentGraph,
  normalizeAgentConfiguration,
  type AgentToolDefinition,
} from "@quickstart/contracts";
import { toAgentJson, toAgentVersionJson } from "../domain/types.js";
import type { AgentsService } from "../services/agents.service.js";
import { routeParam } from "../utils/route-param.js";
import { getAgentCatalog } from "../lib/agent-catalog.js";

export function createAgentsController(agents: AgentsService) {
  return {
    getCatalog: (async (_req, res) => {
      const requestId = requestIdFromResponse(res);
      sendPlatformJson(res, 200, { request_id: requestId, ...getAgentCatalog() });
    }) as RequestHandler,

    createAgent: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const body = req.body as {
        name?: string;
        description?: string | null;
        instructions?: string;
        environment?: string;
        model_settings?: Record<string, unknown>;
        channels?: { chat?: boolean; voice?: boolean };
        tools?: AgentToolDefinition[];
        configuration?: unknown;
      };

      const agent = await agents.createAgent(tenant, {
        name: body?.name ?? "",
        description: body?.description,
        instructions: body?.instructions,
        environment: body?.environment,
        modelSettings: body?.model_settings,
        channels: body?.channels
          ? { chat: body.channels.chat ?? true, voice: body.channels.voice ?? false }
          : undefined,
        tools: body?.tools,
        configuration: body?.configuration
          ? normalizeAgentConfiguration(body.configuration)
          : undefined,
      });

      sendPlatformJson(res, 201, {
        request_id: requestId,
        agent: toAgentJson(agent),
      });
    }) as RequestHandler,

    listAgents: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const limit = Math.min(Math.max(Number(req.query.limit ?? 50), 1), 100);
      const list = await agents.listAgents(tenant, {
        includeArchived: req.query.include_archived === "true",
        limit,
        cursor: typeof req.query.cursor === "string" ? req.query.cursor : undefined,
      });
      sendPlatformJson(res, 200, {
        request_id: requestId,
        agents: list.items.map(toAgentJson),
        next_cursor: list.nextCursor,
      });
    }) as RequestHandler,

    getAgent: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const agentId = routeParam(req.params.agentId);
      const agent = await agents.getAgent(tenant, agentId);
      sendPlatformJson(res, 200, {
        request_id: requestId,
        agent: toAgentJson(agent),
      });
    }) as RequestHandler,

    updateAgent: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const agentId = routeParam(req.params.agentId);
      const body = req.body as {
        name?: string;
        description?: string | null;
        instructions?: string;
        environment?: string;
        model_settings?: Record<string, unknown>;
        channels?: { chat?: boolean; voice?: boolean };
        expected_version?: number;
        version?: number;
        tools?: AgentToolDefinition[];
        voice?: import("@quickstart/contracts").AgentVoiceSettings;
        configuration?: unknown;
      };

      const expectedVersion = body.expected_version ?? body.version;
      const agent = await agents.updateAgent(tenant, agentId, {
        name: body.name,
        description: body.description,
        instructions: body.instructions,
        environment: body.environment,
        modelSettings: body.model_settings,
        channels: body.channels
          ? { chat: body.channels.chat ?? true, voice: body.channels.voice ?? false }
          : undefined,
        tools: body.tools,
        voice: body.voice,
        configuration: body.configuration
          ? normalizeAgentConfiguration(body.configuration)
          : undefined,
        expectedVersion: expectedVersion as number,
      });

      sendPlatformJson(res, 200, {
        request_id: requestId,
        agent: toAgentJson(agent),
      });
    }) as RequestHandler,

    deleteAgent: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const agentId = routeParam(req.params.agentId);
      await agents.deleteAgent(tenant, agentId);
      sendPlatformJson(res, 200, {
        request_id: requestId,
        deleted: true,
      });
    }) as RequestHandler,

    archiveAgent: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const agentId = routeParam(req.params.agentId);
      const body = req.body as { archived?: boolean };
      const agent = await agents.archiveAgent(tenant, agentId, body.archived !== false);
      sendPlatformJson(res, 200, { request_id: requestId, agent: toAgentJson(agent) });
    }) as RequestHandler,

    setCanary: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const agentId = routeParam(req.params.agentId);
      const body = req.body as { version_id?: string | null; canary_percentage?: number };
      const agent = await agents.setCanary(
        tenant,
        agentId,
        body.version_id ?? null,
        Number(body.canary_percentage ?? 0),
      );
      sendPlatformJson(res, 200, { request_id: requestId, agent: toAgentJson(agent) });
    }) as RequestHandler,

    scheduleRelease: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const agentId = routeParam(req.params.agentId);
      const body = req.body as { version_id?: string; publish_at?: string };
      const agent = await agents.scheduleRelease(
        tenant,
        agentId,
        body.version_id ?? "",
        body.publish_at ?? "",
      );
      sendPlatformJson(res, 200, { request_id: requestId, agent: toAgentJson(agent) });
    }) as RequestHandler,

    getEnvironmentComparison: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const agentId = routeParam(req.params.agentId);
      const environments = await agents.getEnvironmentComparison(tenant, agentId);
      sendPlatformJson(res, 200, { request_id: requestId, environments });
    }) as RequestHandler,

    archiveAgents: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const body = req.body as { agent_ids?: string[]; archived?: boolean };
      const result = await agents.archiveAgents(
        tenant,
        body.agent_ids ?? [],
        body.archived !== false,
      );
      sendPlatformJson(res, 200, { request_id: requestId, agents: result.map(toAgentJson) });
    }) as RequestHandler,

    getReleaseReadiness: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const agentId = routeParam(req.params.agentId);
      const readiness = await agents.getReleaseReadiness(tenant, agentId);
      sendPlatformJson(res, 200, { request_id: requestId, ...readiness });
    }) as RequestHandler,

    getGraph: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const agentId = routeParam(req.params.agentId);
      const agent = await agents.getAgent(tenant, agentId);
      const graph =
        agent.draftGraph ??
        (agent.builderMode === "legacy"
          ? createDefaultAgentGraph({
              channels: agent.channels,
              knowledge: agent.configuration?.knowledge,
            })
          : null);
      sendPlatformJson(res, 200, {
        request_id: requestId,
        graph,
        schema_version: agent.graphSchemaVersion ?? 1,
        agent_version: agent.version,
        draft_revision: agent.version,
        builder_mode: agent.builderMode ?? "legacy",
      });
    }) as RequestHandler,

    updateGraph: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const agentId = routeParam(req.params.agentId);
      const body = req.body as {
        graph?: import("@quickstart/contracts").AgentGraph;
        expected_version?: number;
        expected_revision?: number;
        settings?: import("@quickstart/contracts").GraphDraftSettings;
      };
      const agent = await agents.updateGraph(
        tenant,
        agentId,
        body.graph!,
        Number(body.expected_version ?? body.expected_revision),
        body.settings,
      );
      sendPlatformJson(res, 200, {
        request_id: requestId,
        agent: toAgentJson(agent),
        draft_revision: agent.version,
        updated_at: agent.updatedAt.toISOString(),
      });
    }) as RequestHandler,

    validateGraph: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const agentId = routeParam(req.params.agentId);
      const body = req.body as {
        graph?: import("@quickstart/contracts").AgentGraph;
      };
      const validation = await agents.validateGraph(tenant, agentId, body.graph!);
      sendPlatformJson(res, 200, {
        request_id: requestId,
        ...validation,
      });
    }) as RequestHandler,

    proposeAiEdit: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const agentId = routeParam(req.params.agentId);
      const body = req.body as { prompt?: string };
      const proposal = await agents.proposeAiEdit(tenant, agentId, { prompt: body?.prompt ?? "" });
      sendPlatformJson(res, 200, { request_id: requestId, ...proposal });
    }) as RequestHandler,

    publishAgent: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const agentId = routeParam(req.params.agentId);
      const body = req.body as {
        base_version?: number;
        version?: number;
        release_notes?: string;
        expected_revision?: number;
        approval?: { approved?: boolean; note?: string };
        completed_checklist?: string[];
      };
      const baseVersion = body.base_version ?? body.expected_revision ?? body.version;

      const result = await agents.publish(tenant, agentId, baseVersion as number, {
        requestId,
        releaseNotes: body.release_notes,
        approval: body.approval
          ? { approved: body.approval.approved === true, note: body.approval.note }
          : undefined,
        completedChecklist: body.completed_checklist,
      });

      sendPlatformJson(res, 201, {
        request_id: requestId,
        version: toAgentVersionJson(result.version),
        agent: toAgentJson(result.agent),
        release_number: result.version.releaseNumber,
        version_id: result.version.id,
      });
    }) as RequestHandler,

    rollbackAgent: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const agentId = routeParam(req.params.agentId);
      const body = req.body as { version_id?: string };

      const result = await agents.rollback(tenant, agentId, body.version_id ?? "");

      sendPlatformJson(res, 200, {
        request_id: requestId,
        version: toAgentVersionJson(result.version),
        agent: toAgentJson(result.agent),
        release_number: result.version.releaseNumber,
        version_id: result.version.id,
      });
    }) as RequestHandler,

    listVersions: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const agentId = routeParam(req.params.agentId);
      const limit = req.query.limit ? Number(req.query.limit) : 50;

      const list = await agents.listVersions(tenant, agentId, limit);

      sendPlatformJson(res, 200, {
        request_id: requestId,
        versions: list.map(toAgentVersionJson),
      });
    }) as RequestHandler,

    getVersion: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const agentId = routeParam(req.params.agentId);
      const versionId = routeParam(req.params.versionId);

      const version = await agents.getVersion(tenant, agentId, versionId);

      sendPlatformJson(res, 200, {
        request_id: requestId,
        version: toAgentVersionJson(version),
      });
    }) as RequestHandler,

    diffVersions: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const agentId = routeParam(req.params.agentId);
      const leftId = routeParam(req.params.leftId);
      const rightId = routeParam(req.params.rightId);

      const diff = await agents.diffVersions(tenant, agentId, leftId, rightId);

      sendPlatformJson(res, 200, {
        request_id: requestId,
        left_id: diff.leftId,
        right_id: diff.rightId,
        fields: diff.fields,
      });
    }) as RequestHandler,
  };
}
