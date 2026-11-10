import { AppError, ErrorCode } from "@quickstart/errors";
import { requestIdFromResponse, sendPlatformJson, type RequestHandler } from "@quickstart/http-server";
import type {
  InboundSetupInfo,
  PhoneNumberSearchFilters,
  PhoneNumberType,
} from "@quickstart/contracts";
import type { PhoneNumbersService, ReleaseMode } from "../services/phone-numbers.service.js";
import { routeParam } from "../lib/route-param.js";

function parseFilters(query: Record<string, unknown>): PhoneNumberSearchFilters {
  const numberType = typeof query.number_type === "string" ? query.number_type : undefined;
  return {
    country_code: typeof query.country_code === "string" ? query.country_code : undefined,
    area_code: typeof query.area_code === "string" ? query.area_code : undefined,
    locality: typeof query.locality === "string" ? query.locality : undefined,
    state: typeof query.state === "string" ? query.state : undefined,
    number_type: numberType as PhoneNumberType | undefined,
    limit: query.limit === undefined ? undefined : Number(query.limit),
  };
}

export type PhoneNumbersControllerOptions = {
  providerConfigured: boolean;
  purchaseAvailable: boolean;
  inboundSetup?: {
    build(): Promise<InboundSetupInfo>;
  };
};

export function createPhoneNumbersController(
  service: PhoneNumbersService,
  options: PhoneNumbersControllerOptions,
) {
  return {
    list: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const [numbers, pool] = await Promise.all([
        service.list(workspaceId, { sync: req.query.sync === "true" }),
        service.listPool(),
      ]);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        configured: options.providerConfigured,
        purchase_available: options.purchaseAvailable,
        byo_sip_available: true,
        numbers,
        pool,
      });
    }) as RequestHandler,

    setup: (async (_req, res) => {
      if (!options.inboundSetup) {
        throw new AppError({
          code: ErrorCode.NOT_FOUND,
          message: "SIP setup readiness check is not available",
        });
      }
      const info = await options.inboundSetup.build();
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        ...info,
      });
    }) as RequestHandler,

    available: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const result = await service.searchAvailable(
        workspaceId,
        parseFilters(req.query as Record<string, unknown>),
      );
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        ...result,
      });
    }) as RequestHandler,

    purchase: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const body = (req.body ?? {}) as {
        e164?: string;
        agent_id?: string | null;
        friendly_name?: string | null;
        country_code?: string;
        number_type?: PhoneNumberType;
      };
      if (!body.e164) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "e164 is required",
        });
      }
      const number = await service.purchase(workspaceId, {
        e164: body.e164,
        agent_id: body.agent_id ?? null,
        friendly_name: body.friendly_name ?? null,
        country_code: body.country_code,
        number_type: body.number_type,
      });
      sendPlatformJson(res, 201, {
        request_id: requestIdFromResponse(res),
        number,
      });
    }) as RequestHandler,

    registerByo: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const body = (req.body ?? {}) as {
        e164?: string;
        agent_id?: string | null;
        friendly_name?: string | null;
        allowed_addresses?: string[];
        auth_username?: string | null;
        generate_credentials?: boolean;
      };
      if (!body.e164) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "e164 is required",
        });
      }
      const result = await service.registerByo(workspaceId, {
        e164: body.e164,
        agent_id: body.agent_id ?? null,
        friendly_name: body.friendly_name ?? null,
        allowed_addresses: body.allowed_addresses,
        auth_username: body.auth_username ?? null,
        generate_credentials: body.generate_credentials,
      });
      sendPlatformJson(res, 201, {
        request_id: requestIdFromResponse(res),
        ...result,
      });
    }) as RequestHandler,

    getSipConnection: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const numberId = routeParam(req.params.numberId);
      const connection = await service.getSipConnection(workspaceId, numberId);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        connection,
      });
    }) as RequestHandler,

    rotateCredentials: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const numberId = routeParam(req.params.numberId);
      const result = await service.rotateByoCredentials(workspaceId, numberId);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        ...result,
      });
    }) as RequestHandler,

    update: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const numberId = routeParam(req.params.numberId);
      const body = (req.body ?? {}) as {
        agent_id?: string | null;
        assigned_agent_id?: string | null;
        friendly_name?: string | null;
        allowed_addresses?: string[];
      };
      if (
        body.agent_id === undefined &&
        body.assigned_agent_id === undefined &&
        body.friendly_name === undefined &&
        body.allowed_addresses === undefined
      ) {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "Provide agent_id, friendly_name, or allowed_addresses",
        });
      }
      let number;
      if (body.allowed_addresses !== undefined) {
        number = await service.updateByoAccess(workspaceId, numberId, body.allowed_addresses);
      }
      if (
        body.agent_id !== undefined ||
        body.assigned_agent_id !== undefined ||
        body.friendly_name !== undefined
      ) {
        number = await service.assign(workspaceId, numberId, {
          assigned_agent_id:
            body.assigned_agent_id !== undefined ? body.assigned_agent_id : body.agent_id,
          friendly_name: body.friendly_name,
        });
      }
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        number,
      });
    }) as RequestHandler,

    release: (async (req, res) => {
      const workspaceId = routeParam(req.params.workspaceId);
      const numberId = routeParam(req.params.numberId);
      const rawMode = typeof req.query.mode === "string" ? req.query.mode : "pool";
      if (rawMode !== "pool" && rawMode !== "provider") {
        throw new AppError({
          code: ErrorCode.VALIDATION_FAILED,
          message: "mode must be pool or provider",
        });
      }
      const number = await service.release(workspaceId, numberId, rawMode as ReleaseMode);
      sendPlatformJson(res, 200, {
        request_id: requestIdFromResponse(res),
        number,
      });
    }) as RequestHandler,
  };
}
