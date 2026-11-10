import { WORKSPACE_PERMISSIONS } from "@quickstart/contracts";
import {
  requestIdFromResponse,
  sendPlatformJson,
  type RequestHandler,
} from "@quickstart/http-server";
import type { SecretsService } from "../services/secrets.service.js";
import { routeParam } from "../utils/route-param.js";

export function createSecretsController(secrets: SecretsService) {
  return {
    /** GET /v1/workspaces/:workspaceId/secrets — names only, no ciphertext, no value */
    list: (async (_req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const items = await secrets.listNames(tenant.workspaceId);
      sendPlatformJson(res, 200, {
        request_id: requestId,
        secrets: items,
        total: items.length,
      });
    }) as RequestHandler,

    /** POST /v1/workspaces/:workspaceId/secrets — create or overwrite by name */
    create: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const body = req.body as { name?: string; value?: string };
      const secret = await secrets.create(
        tenant.workspaceId,
        {
          name: body.name ?? "",
          value: body.value ?? "",
        },
        { actorUserId: tenant.actorId, requestId },
      );
      sendPlatformJson(res, 201, { request_id: requestId, secret });
    }) as RequestHandler,

    /** PUT /v1/workspaces/:workspaceId/secrets/:name/rotate — re-encrypt with current key */
    rotate: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const name = routeParam(req.params.name);
      // For a key rotation request, the new key comes from the running env — same service instance.
      // The service.rotate method reads newEncryptionKey from its own config.
      // We expose a separate inject for the new key only in tests; in prod the service restarts with the new key.
      const secret = await secrets.rotate(
        tenant.workspaceId,
        name,
        // Pass the current key as "new" key for same-key re-encryption (refresh IV).
        // True rotation requires restarting with new ENCRYPTION_KEY env var then calling this endpoint.
        (secrets as unknown as { encryptionKey: string }).encryptionKey,
        (secrets as unknown as { keyVersion: number }).keyVersion,
        { actorUserId: tenant.actorId, requestId },
      );
      sendPlatformJson(res, 200, { request_id: requestId, secret });
    }) as RequestHandler,

    /** DELETE /v1/workspaces/:workspaceId/secrets/:name */
    deleteByName: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const tenant = res.locals.tenantContext!;
      const name = routeParam(req.params.name);
      await secrets.delete(tenant.workspaceId, name, {
        actorUserId: tenant.actorId,
        requestId,
      });
      sendPlatformJson(res, 200, { request_id: requestId, deleted: true });
    }) as RequestHandler,
  };
}

/** Audit actor used for trusted internal-service writes (UUID column). */
const INTERNAL_SERVICE_ACTOR_ID = "00000000-0000-0000-0000-000000000000";

/** Internal controller — decrypts and returns plaintext to trusted callers, and handles internal service secret management */
export function createInternalSecretsController(secrets: SecretsService) {
  return {
    /** GET /internal/workspaces/:workspaceId/secrets — names only for trusted readiness checks */
    list: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const workspaceId = routeParam(req.params.workspaceId);
      const items = await secrets.listNames(workspaceId);
      sendPlatformJson(res, 200, { request_id: requestId, secrets: items, total: items.length });
    }) as RequestHandler,

    /** GET /internal/workspaces/:workspaceId/secrets/:name/value */
    reveal: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const workspaceId = routeParam(req.params.workspaceId);
      const name = routeParam(req.params.name);
      const value = await secrets.revealValue(workspaceId, name);
      sendPlatformJson(res, 200, { request_id: requestId, value });
    }) as RequestHandler,

    /** POST /internal/workspaces/:workspaceId/secrets */
    create: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const workspaceId = routeParam(req.params.workspaceId);
      const body = req.body as { name?: string; value?: string };
      const secret = await secrets.create(
        workspaceId,
        {
          name: body.name ?? "",
          value: body.value ?? "",
        },
        { actorUserId: INTERNAL_SERVICE_ACTOR_ID, serviceActor: true, requestId },
      );
      sendPlatformJson(res, 201, { request_id: requestId, secret });
    }) as RequestHandler,

    /** DELETE /internal/workspaces/:workspaceId/secrets/:name */
    deleteByName: (async (req, res) => {
      const requestId = requestIdFromResponse(res);
      const workspaceId = routeParam(req.params.workspaceId);
      const name = routeParam(req.params.name);
      await secrets.delete(workspaceId, name, {
        actorUserId: INTERNAL_SERVICE_ACTOR_ID,
        serviceActor: true,
        requestId,
      });
      sendPlatformJson(res, 200, { request_id: requestId, deleted: true });
    }) as RequestHandler,
  };
}

export const SECRET_READ = WORKSPACE_PERMISSIONS.SECRET_READ;
export const SECRET_WRITE = WORKSPACE_PERMISSIONS.SECRET_WRITE;
