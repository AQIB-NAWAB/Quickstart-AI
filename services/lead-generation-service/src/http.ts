import { timingSafeEqual } from "node:crypto";
import { bearerTokenFromHeader, verifyAccessToken } from "@quickstart/auth";
import { roleHasPermission } from "@quickstart/contracts";
import {
  createPlatformApp,
  createServiceRouter,
  asyncHandler,
  requestIdFromResponse,
  type Request,
  type Response,
  type Application,
} from "@quickstart/http-server";
import type { WorkspaceAccessClient } from "@quickstart/workspace-access";
import type { Logger } from "@quickstart/logging";
import { AppError, ErrorCode } from "@quickstart/errors";
import { Store, type Identity } from "./store.js";
import type { Config } from "./config.js";
import {
  object,
  text,
  uuid,
  key,
  integer,
  businessInput,
  runInput,
  fail,
  policyInput,
  connectorInput,
  collectionInput,
  applyFieldMapping,
  leadSalesUpdateInput,
  scheduleInput,
} from "./domain.js";

function param(req: Request, name: string): string {
  const v = req.params[name];
  return Array.isArray(v) ? v[0] : v;
}
function identity(res: Response): Identity {
  return res.locals.leadIdentity as Identity;
}
export function createServer(
  config: Config,
  store: Store,
  access: WorkspaceAccessClient,
  logger: Logger,
): Application {
  const router = createServiceRouter();
  router.get("/healthz", (_req, res) =>
    res.json({ ok: true, service: "lead-generation", mode: config.live ? "live" : "demo" }),
  );
  router.get(
    "/readyz",
    asyncHandler(async (_req, res) => {
      await store.pool.query("SELECT 1 FROM lg_control");
      res.json({ ok: true });
    }),
  );
  router.use("/internal/lead-generation", (req, res, next) => {
    const token = bearerTokenFromHeader(req.headers.authorization) ?? "";
    const a = Buffer.from(token),
      b = Buffer.from(config.admin);
    if (a.length !== b.length || !timingSafeEqual(a, b))
      return next(
        new AppError({
          code: ErrorCode.UNAUTHORIZED,
          message: "Platform admin authentication required",
        }),
      );
    res.locals.adminActor =
      typeof req.headers["x-admin-actor"] === "string"
        ? req.headers["x-admin-actor"].slice(0, 200)
        : "platform-admin";
    next();
  });
  router.get(
    "/internal/lead-generation/settings",
    asyncHandler(async (_req, res) => res.json(await store.settings())),
  );
  router.get(
    "/internal/lead-generation/tenants/:orgId/policy",
    asyncHandler(async (req, res) => res.json(await store.policy(uuid(param(req, "orgId"))))),
  );
  router.get(
    "/internal/lead-generation/audit",
    asyncHandler(async (req, res) => {
      const after = integer(Number(req.query.after ?? 0), "after", 0, Number.MAX_SAFE_INTEGER);
      const rows = (
        await store.pool.query("SELECT * FROM lg_audit WHERE id>$1 ORDER BY id LIMIT 100", [after])
      ).rows;
      res.json({ items: rows, next_cursor: rows.length === 100 ? String(rows.at(-1).id) : null });
    }),
  );
  router.put(
    "/internal/lead-generation/settings",
    asyncHandler(async (req, res) => {
      const b = object(req.body);
      const scope = text(b.scope, "scope", 10);
      if (!["global", "tier", "tenant"].includes(scope)) fail("Unknown settings scope");
      const policy =
        b.policy === null ? null : b.policy === undefined ? undefined : object(b.policy);
      if (policy) policyInput(policy);
      const input = {
        scope: scope as "global" | "tier" | "tenant",
        expected_version: integer(b.expected_version, "expected_version", 0, 1_000_000),
        reason: text(b.reason, "reason", 500),
        ...(policy === undefined ? {} : { policy }),
        ...(scope === "tier" ? { name: text(b.name, "name", 50) } : {}),
        ...(scope === "tenant"
          ? {
              org_id: uuid(b.org_id),
              ...(b.tier_name === undefined
                ? {}
                : { tier_name: b.tier_name === null ? null : text(b.tier_name, "tier_name", 50) }),
            }
          : {}),
        ...(b.global_active_limit === undefined
          ? {}
          : { global_active_limit: integer(b.global_active_limit, "global_active_limit", 1, 100) }),
      };
      const result = await store.changeSettings(
        {
          orgId: "",
          workspaceId: "",
          actorId: res.locals.adminActor,
          requestId: requestIdFromResponse(res),
        },
        input,
      );
      res.json(result);
    }),
  );
  router.get(
    "/internal/lead-generation/metrics",
    asyncHandler(async (_req, res) => {
      const m = await store.metrics();
      const lines = [
        "# TYPE quickstart_lead_tasks gauge",
        ...m.tasks.map(
          (r) => `quickstart_lead_tasks{kind="${r.kind}",state="${r.state}"} ${r.count}`,
        ),
        "# TYPE quickstart_lead_runs gauge",
        ...m.runs.map((r) => `quickstart_lead_runs{status="${r.status}"} ${r.count}`),
        "# TYPE quickstart_lead_oldest_queue_seconds gauge",
        `quickstart_lead_oldest_queue_seconds ${m.oldest_queue_seconds}`,
      ];
      res.type("text/plain").send(lines.join("\n") + "\n");
    }),
  );
  router.post(
    "/v1/inbound/ingest/:connectorId",
    asyncHandler(async (req, res) => {
      const connectorId = uuid(param(req, "connectorId"));
      const rawToken = bearerTokenFromHeader(req.headers.authorization);
      if (!rawToken) {
        fail("Inbound connector authentication required", ErrorCode.UNAUTHORIZED);
      }
      const rawBody = req.body;
      let records: Record<string, unknown>[] = [];
      let bodyCollectionId: string | undefined;

      if (Array.isArray(rawBody)) {
        records = rawBody.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
      } else if (rawBody && typeof rawBody === "object") {
        const obj = rawBody as Record<string, unknown>;
        if (typeof obj.collection_id === "string") bodyCollectionId = obj.collection_id;
        else if (typeof obj.collectionId === "string") bodyCollectionId = obj.collectionId;

        if (Array.isArray(obj.records)) {
          records = obj.records.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
        } else if (Array.isArray(obj.items)) {
          records = obj.items.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
        } else if (Array.isArray(obj.leads)) {
          records = obj.leads.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
        } else {
          // Single lead record
          records = [obj];
        }
      }

      if (records.length === 0) {
        fail("No lead records found in payload", ErrorCode.VALIDATION_FAILED);
      }

      const idempotencyKey =
        (typeof req.headers["idempotency-key"] === "string" && req.headers["idempotency-key"]) ||
        (typeof req.headers["x-idempotency-key"] === "string" && req.headers["x-idempotency-key"]) ||
        (rawBody && typeof rawBody === "object" && typeof (rawBody as any).idempotency_key === "string" && (rawBody as any).idempotency_key) ||
        undefined;

      const headerCollectionId = typeof req.headers["x-collection-id"] === "string" ? req.headers["x-collection-id"] : undefined;
      const queryCollectionId = typeof req.query.collection_id === "string" ? req.query.collection_id : undefined;
      const collectionId = headerCollectionId || queryCollectionId || bodyCollectionId;

      const result = await store.ingestInboundBatch({
        connectorId,
        token: rawToken,
        idempotencyKey,
        records,
        collectionId,
        config,
      });

      res.status(result.status === "failed" ? 422 : 200).json(result);
    }),
  );

  const base = "/v1/workspaces/:workspaceId/lead-generation";
  const orgCache = new Map<string, { orgId: string; expiresAt: number }>();
  const roleCache = new Map<string, { role: Parameters<typeof roleHasPermission>[0]; expiresAt: number }>();

  router.use(
    base,
    asyncHandler(async (req, res, next) => {
      const raw = bearerTokenFromHeader(req.headers.authorization);
      if (!raw) fail("Authentication required", ErrorCode.UNAUTHORIZED);
      let claims;
      try {
        claims = await verifyAccessToken(raw, config.jwt);
      } catch {
        fail("Invalid access token", ErrorCode.UNAUTHORIZED);
      }
      const workspace = uuid(param(req, "workspaceId"));
      const requestId = requestIdFromResponse(res);

      const roleKey = `${workspace}:${claims.sub}`;
      const cachedRole = process.env.NODE_ENV !== "test" ? roleCache.get(roleKey) : null;
      let role = cachedRole && cachedRole.expiresAt > Date.now() ? cachedRole.role : null;

      if (!role) {
        role = await access.resolveRole(
          workspace,
          claims.sub,
          req.headers.authorization,
          requestId,
        );
        if (process.env.NODE_ENV !== "test") {
          roleCache.set(roleKey, { role, expiresAt: Date.now() + 60_000 });
        }
      }

      const permission = req.method === "GET" ? "workspace.leads.read" : "workspace.leads.write";
      if (!roleHasPermission(role, permission))
        fail("Role cannot perform this lead generation action", ErrorCode.FORBIDDEN);

      const cachedOrg = orgCache.get(workspace);
      let org = cachedOrg && cachedOrg.expiresAt > Date.now() ? cachedOrg.orgId : null;

      if (!org) {
        const reply = await fetch(`${config.workspaceUrl}/v1/workspaces/${workspace}`, {
          headers: { authorization: `Bearer ${raw}` },
          signal: AbortSignal.timeout(5000),
        });
        if (!reply.ok) fail("Cannot verify workspace organization", ErrorCode.UPSTREAM_UNAVAILABLE);
        const response = object(await reply.json());
        const ws = object(response.workspace);
        org = uuid(ws.orgId ?? ws.org_id);
        orgCache.set(workspace, { orgId: org, expiresAt: Date.now() + 300_000 });
      }

      res.locals.leadIdentity = {
        orgId: org,
        workspaceId: workspace,
        actorId: claims.sub,
        requestId,
      } satisfies Identity;
      await store.apiRate(org, req.method !== "GET" && !req.path.endsWith("/cancel"));
      next();
    }),
  );
  router.get(
    `${base}/profile`,
    asyncHandler(async (_req, res) => res.json({ profile: await store.profile(identity(res)) })),
  );
  router.put(
    `${base}/profile`,
    asyncHandler(async (req, res) => {
      const b = object(req.body);
      const profile = await store.putProfile(
        identity(res),
        businessInput(b.business),
        integer(b.expected_version, "expected_version", 0, 1_000_000),
      );
      res.status(202).json({ profile, research_scheduled: true });
    }),
  );
  router.get(
    `${base}/policy`,
    asyncHandler(async (_req, res) => res.json(await store.policy(identity(res).orgId))),
  );
  router.post(
    `${base}/runs`,
    asyncHandler(async (req, res) => {
      const result = await store.createRun(
        identity(res),
        runInput(req.body),
        key(req.headers["idempotency-key"]),
      );
      res.status(result.deduplicated ? 200 : 202).json(result);
    }),
  );
  const pagination = (req: Request) => ({
    after: req.query.after ? uuid(req.query.after) : null,
    limit: integer(Number(req.query.limit ?? 50), "limit", 1, 100),
  });
  for (const resource of ["runs", "leads"] as const)
    router.get(
      `${base}/${resource}`,
      asyncHandler(async (req, res) => {
        const p = pagination(req),
          rows = await store.list(identity(res), resource, p.after, p.limit);
        res.json({ items: rows, next_cursor: rows.length === p.limit ? rows.at(-1).id : null });
      }),
    );
  router.get(
    `${base}/leads/:leadId`,
    asyncHandler(async (req, res) =>
      res.json({ lead: await store.getLeadWithDetails(identity(res), uuid(param(req, "leadId"))) }),
    ),
  );
  router.patch(
    `${base}/leads/:leadId/sales-status`,
    asyncHandler(async (req, res) => {
      const b = object(req.body);
      const update = leadSalesUpdateInput(b);
      const lead = await store.updateLeadSalesStatus(
        identity(res),
        uuid(param(req, "leadId")),
        update.status,
        update.notes,
        update.user_edited_fields,
      );
      res.json({ lead });
    }),
  );
  router.get(
    `${base}/leads/:leadId/observations`,
    asyncHandler(async (req, res) =>
      res.json({ items: await store.getLeadObservations(identity(res), uuid(param(req, "leadId"))) }),
    ),
  );
  router.post(
    `${base}/leads/export/csv`,
    asyncHandler(async (req, res) => {
      const runId = req.query.run_id ? uuid(req.query.run_id) : undefined;
      const csv = await store.exportLeadsToCsv(identity(res), runId);
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", 'attachment; filename="leads-export.csv"');
      res.send(csv);
    }),
  );
  router.get(
    `${base}/schedules`,
    asyncHandler(async (_req, res) =>
      res.json({ items: await store.listSchedules(identity(res)) }),
    ),
  );
  router.post(
    `${base}/schedules`,
    asyncHandler(async (req, res) => {
      const sched = scheduleInput(req.body);
      res.status(201).json({ schedule: await store.createSchedule(identity(res), sched) });
    }),
  );
  router.get(
    `${base}/schedules/:scheduleId`,
    asyncHandler(async (req, res) =>
      res.json({ schedule: await store.getSchedule(identity(res), uuid(param(req, "scheduleId"))) }),
    ),
  );
  router.patch(
    `${base}/schedules/:scheduleId`,
    asyncHandler(async (req, res) => {
      const scheduleId = uuid(param(req, "scheduleId"));
      const current = await store.getSchedule(identity(res), scheduleId);
      const patch = scheduleInput({ ...current, ...object(req.body) });
      res.json({ schedule: await store.updateSchedule(identity(res), scheduleId, patch) });
    }),
  );
  router.delete(
    `${base}/schedules/:scheduleId`,
    asyncHandler(async (req, res) =>
      res.json(await store.deleteSchedule(identity(res), uuid(param(req, "scheduleId")))),
    ),
  );
  router.get(
    `${base}/runs/:runId`,
    asyncHandler(async (req, res) =>
      res.json({ run: await store.run(identity(res), uuid(param(req, "runId"))) }),
    ),
  );
  router.get(
    `${base}/runs/:runId/results`,
    asyncHandler(async (req, res) => {
      const p = pagination(req),
        rows = await store.results(identity(res), uuid(param(req, "runId")), p.after, p.limit);
      res.json({ items: rows, next_cursor: rows.length === p.limit ? rows.at(-1).id : null });
    }),
  );
  router.get(
    `${base}/runs/:runId/deliveries`,
    asyncHandler(async (req, res) =>
      res.json({ items: await store.deliveries(identity(res), uuid(param(req, "runId"))) }),
    ),
  );
  router.post(
    `${base}/runs/:runId/cancel`,
    asyncHandler(async (req, res) =>
      res.json({ run: await store.cancel(identity(res), uuid(param(req, "runId"))) }),
    ),
  );
  router.post(
    `${base}/deliveries/:taskId/retry`,
    asyncHandler(async (req, res) =>
      res.status(202).json(await store.retryFailed(identity(res), uuid(param(req, "taskId")))),
    ),
  );
  router.get(
    `${base}/audit`,
    asyncHandler(async (req, res) => {
      const after = String(
        integer(Number(req.query.after ?? 0), "after", 0, Number.MAX_SAFE_INTEGER),
      );
      const rows = await store.list(identity(res), "audit", after, 100);
      res.json({ items: rows, next_cursor: rows.length === 100 ? String(rows.at(-1).id) : null });
    }),
  );
  router.get(
    `${base}/usage`,
    asyncHandler(async (_req, res) => {
      const rows = (
        await store.pool.query(
          "SELECT * FROM lg_usage_daily WHERE org_id=$1 ORDER BY day DESC LIMIT 31",
          [identity(res).orgId],
        )
      ).rows;
      res.json({ items: rows, scope: "organization", timezone: "UTC" });
    }),
  );
  router.get(
    `${base}/tasks`,
    asyncHandler(async (req, res) => {
      const p = pagination(req),
        i = identity(res);
      const rows = (
        await store.pool.query(
          "SELECT id,run_id,kind,state,attempts,error_code,created_at,available_at FROM lg_tasks WHERE workspace_id=$1 AND org_id=$2 AND execution_mode=$3 AND ($4::uuid IS NULL OR id>$4::uuid) ORDER BY id LIMIT $5",
          [i.workspaceId, i.orgId, store.mode, p.after, p.limit],
        )
      ).rows;
      res.json({ items: rows, next_cursor: rows.length === p.limit ? rows.at(-1).id : null });
    }),
  );

  // Profile Confirmation
  router.post(
    `${base}/profile/confirm`,
    asyncHandler(async (req, res) => {
      const b = object(req.body);
      const confirmedFacts = object(b.confirmed_facts ?? b.confirmedFacts ?? {});
      const inferences = (b.inferences && typeof b.inferences === "object" && !Array.isArray(b.inferences))
        ? (b.inferences as Record<string, unknown>)
        : undefined;
      const profile = await store.confirmProfileFacts(identity(res), {
        approved: b.approved !== false,
        confirmed_facts: confirmedFacts,
        inferences,
        notes: typeof b.notes === "string" ? b.notes : undefined,
      });
      res.json({ profile });
    }),
  );

  // Collections CRUD
  router.get(
    `${base}/collections`,
    asyncHandler(async (_req, res) => {
      const collections = await store.listCollections(identity(res));
      res.json({ items: collections });
    }),
  );
  router.post(
    `${base}/collections`,
    asyncHandler(async (req, res) => {
      const input = collectionInput(req.body);
      const collection = await store.createCollection(identity(res), input);
      res.status(201).json({ collection });
    }),
  );
  router.get(
    `${base}/collections/:collectionId`,
    asyncHandler(async (req, res) => {
      const collection = await store.getCollection(identity(res), uuid(param(req, "collectionId")));
      res.json({ collection });
    }),
  );
  router.patch(
    `${base}/collections/:collectionId`,
    asyncHandler(async (req, res) => {
      const collection = await store.updateCollection(
        identity(res),
        uuid(param(req, "collectionId")),
        object(req.body),
      );
      res.json({ collection });
    }),
  );
  router.delete(
    `${base}/collections/:collectionId`,
    asyncHandler(async (req, res) => {
      await store.deleteCollection(identity(res), uuid(param(req, "collectionId")));
      res.json({ ok: true });
    }),
  );

  // Connectors CRUD
  router.get(
    `${base}/connectors`,
    asyncHandler(async (_req, res) => {
      const connectors = await store.listConnectors(identity(res));
      res.json({ items: connectors });
    }),
  );
  router.post(
    `${base}/connectors`,
    asyncHandler(async (req, res) => {
      const input = connectorInput(req.body);
      const result = await store.createConnector(identity(res), input);
      res.status(201).json(result);
    }),
  );
  router.get(
    `${base}/connectors/:connectorId`,
    asyncHandler(async (req, res) => {
      const connector = await store.getConnector(identity(res), uuid(param(req, "connectorId")));
      res.json({ connector });
    }),
  );
  router.patch(
    `${base}/connectors/:connectorId`,
    asyncHandler(async (req, res) => {
      const connector = await store.updateConnector(
        identity(res),
        uuid(param(req, "connectorId")),
        object(req.body),
      );
      res.json({ connector });
    }),
  );
  router.post(
    `${base}/connectors/:connectorId/rotate`,
    asyncHandler(async (req, res) => {
      const result = await store.rotateConnectorToken(
        identity(res),
        uuid(param(req, "connectorId")),
      );
      res.json(result);
    }),
  );
  router.delete(
    `${base}/connectors/:connectorId`,
    asyncHandler(async (req, res) => {
      await store.revokeConnector(identity(res), uuid(param(req, "connectorId")));
      res.json({ ok: true });
    }),
  );
  router.get(
    `${base}/connectors/:connectorId/batches`,
    asyncHandler(async (req, res) => {
      const batches = await store.listInboundBatches(
        identity(res),
        uuid(param(req, "connectorId")),
      );
      res.json({ items: batches });
    }),
  );
  router.get(
    `${base}/inbound/batches`,
    asyncHandler(async (_req, res) => {
      const batches = await store.listInboundBatches(identity(res));
      res.json({ items: batches });
    }),
  );

  // Field Mapping Testing and Suggestion
  router.post(
    `${base}/connectors/test-mapping`,
    asyncHandler(async (req, res) => {
      const b = object(req.body);
      const sample = object(b.sample_payload ?? b.samplePayload ?? {});
      const mapping = (b.mapping && typeof b.mapping === "object" && !Array.isArray(b.mapping))
        ? (b.mapping as Record<string, string>)
        : {};
      const transformed = applyFieldMapping(sample, mapping);
      const targetFields = ["company_name", "website", "person_name", "person_role", "email", "phone", "industry", "location"];
      const missing = targetFields.filter((f) => !transformed[f] || (typeof transformed[f] === "string" && !(transformed[f] as string).trim()));
      res.json({ transformed, missing_fields: missing });
    }),
  );
  router.post(
    `${base}/connectors/suggest-mapping`,
    asyncHandler(async (req, res) => {
      const b = object(req.body);
      const sample = object(b.sample_payload ?? b.samplePayload ?? {});
      const sampleKeys = Object.keys(sample);

      const fieldKeywords: Record<string, string[]> = {
        company_name: ["company", "companyname", "organization", "org", "business", "businessname"],
        website: ["website", "domain", "url", "web", "link", "site"],
        person_name: ["name", "fullname", "contactname", "person", "leadname", "decisionmaker"],
        person_role: ["role", "title", "jobtitle", "position", "occupation"],
        email: ["email", "mail", "contactemail", "workemail"],
        phone: ["phone", "tel", "telephone", "mobile", "contactphone"],
        location: ["location", "city", "country", "geo", "address", "state", "headquarters"],
        industry: ["industry", "sector", "category", "vertical", "niche"],
        company_size: ["size", "employees", "headcount", "staff", "employeecount"],
        external_id: ["id", "_id", "externalid", "recordid", "leadid"],
      };

      const suggestedMapping: Record<string, string> = {};
      for (const [targetField, keywords] of Object.entries(fieldKeywords)) {
        for (const k of sampleKeys) {
          const lower = k.toLowerCase().replace(/[^a-z0-9]/g, "");
          if (keywords.includes(lower)) {
            suggestedMapping[k] = targetField;
            break;
          }
        }
      }
      res.json({ suggested_mapping: suggestedMapping });
    }),
  );

  return createPlatformApp({
    logger,
    apiRouter: router,
    jsonBodyLimit: "512kb",
    requestTimeoutMs: 15000,
  });
}
