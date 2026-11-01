import type { Logger } from "@quickstart/logging";
import { AccessToken, LiveKitAPI, WebhookReceiver, type WebhookEvent } from "livekit-server-sdk";

export type LiveKitProvisionerConfig = {
  url?: string;
  apiKey?: string;
  apiSecret?: string;
  sipEndpoint?: string;
  logger?: Logger;
};

export type ProvisionedRoute = {
  trunkId: string;
  dispatchRuleId: string;
  roomPrefix: string;
  configured: boolean;
};

export type ProvisionNumberInput = {
  numberId: string;
  e164: string;
  workspaceId: string;
  agentId?: string | null;
};

export interface SipProvisioner {
  readonly configured: boolean;
  readonly sipEndpoint?: string;
  provisionNumber(input: ProvisionNumberInput): Promise<ProvisionedRoute>;
  deprovisionNumber(input: {
    trunkId?: string | null;
    dispatchRuleId?: string | null;
  }): Promise<void>;
  verifyWebhook(rawBody: string, authHeader?: string): Promise<WebhookEvent | null>;
  mintJoinToken(input: { roomName: string; identity: string; name?: string }): Promise<string>;
  removeParticipant(roomName: string, identity: string): Promise<void>;
  endRoom(roomName: string): Promise<void>;
}

export const INBOUND_ROOM_PREFIX = "qs-call-";

export function inboundRoomPrefix(numberId: string): string {
  return `${INBOUND_ROOM_PREFIX}${numberId}-`;
}

/**
 * Room names are `qs-call-<phoneNumberId>-<random>`. Using the number id (not the
 * E.164) keeps PII out of LiveKit logs while making webhook resolution deterministic.
 */
export function numberIdFromRoomName(roomName: string): string | null {
  if (!roomName.startsWith(INBOUND_ROOM_PREFIX)) return null;
  const rest = roomName.slice(INBOUND_ROOM_PREFIX.length);
  const match = /^([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-/i.exec(rest);
  return match?.[1] ?? null;
}

export class LiveKitSipProvisioner implements SipProvisioner {
  readonly configured = true;
  readonly sipEndpoint: string;
  private readonly api: LiveKitAPI;
  private readonly receiver: WebhookReceiver;
  private readonly logger?: Logger;
  private readonly apiKey: string;
  private readonly apiSecret: string;

  constructor(config: LiveKitProvisionerConfig & {
    url: string;
    apiKey: string;
    apiSecret: string;
    sipEndpoint: string;
  }) {
    this.api = new LiveKitAPI({
      host: config.url,
      apiKey: config.apiKey,
      secret: config.apiSecret,
    });
    this.receiver = new WebhookReceiver(config.apiKey, config.apiSecret);
    this.sipEndpoint = config.sipEndpoint;
    this.logger = config.logger;
    this.apiKey = config.apiKey;
    this.apiSecret = config.apiSecret;
  }

  async provisionNumber(input: ProvisionNumberInput): Promise<ProvisionedRoute> {
    const name = `qs-${input.numberId}`;
    const metadata = JSON.stringify({
      number_id: input.numberId,
      workspace_id: input.workspaceId,
      agent_id: input.agentId ?? null,
    });
    try {
      const trunk = await this.api.sip.createSipInboundTrunk(name, [input.e164], {
        metadata,
        krispEnabled: true,
      });
      const rule = await this.api.sip.createSipDispatchRule(
        { type: "individual", roomPrefix: inboundRoomPrefix(input.numberId) },
        {
          name,
          trunkIds: [trunk.sipTrunkId],
          metadata,
        },
      );
      return {
        trunkId: trunk.sipTrunkId,
        dispatchRuleId: rule.sipDispatchRuleId,
        roomPrefix: inboundRoomPrefix(input.numberId),
        configured: true,
      };
    } catch (err) {
      this.logger?.error("livekit.sip.provision_failed", {
        number_id: input.numberId,
        error: err instanceof Error ? err.message : String(err),
      });
      throw err;
    }
  }

  async deprovisionNumber(input: {
    trunkId?: string | null;
    dispatchRuleId?: string | null;
  }): Promise<void> {
    if (input.dispatchRuleId) {
      await this.api.sip.deleteSipDispatchRule(input.dispatchRuleId).catch((err: unknown) => {
        this.logger?.warn("livekit.sip.delete_rule_failed", {
          dispatch_rule_id: input.dispatchRuleId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
    if (input.trunkId) {
      await this.api.sip.deleteSipTrunk(input.trunkId).catch((err: unknown) => {
        this.logger?.warn("livekit.sip.delete_trunk_failed", {
          trunk_id: input.trunkId,
          error: err instanceof Error ? err.message : String(err),
        });
      });
    }
  }

  async verifyWebhook(rawBody: string, authHeader?: string): Promise<WebhookEvent | null> {
    try {
      return await this.receiver.receive(rawBody, authHeader);
    } catch (err) {
      this.logger?.warn("livekit.webhook.invalid_signature", {
        error: err instanceof Error ? err.message : String(err),
      });
      return null;
    }
  }

  async mintJoinToken(input: {
    roomName: string;
    identity: string;
    name?: string;
  }): Promise<string> {
    const token = new AccessToken(this.apiKey, this.apiSecret, {
      identity: input.identity,
      name: input.name ?? input.identity,
      ttl: "1h",
    });
    token.addGrant({
      roomJoin: true,
      room: input.roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });
    return token.toJwt();
  }

  async removeParticipant(roomName: string, identity: string): Promise<void> {
    await this.api.room.removeParticipant(roomName, identity).catch((err: unknown) => {
      this.logger?.warn("livekit.room.remove_participant_failed", {
        room: roomName,
        identity,
        error: err instanceof Error ? err.message : String(err),
      });
    });
  }

  async endRoom(roomName: string): Promise<void> {
    await this.api.room.deleteRoom(roomName);
  }
}

/**
 * Deterministic provisioner for TELEPHONY_PROFILE=fake. It lets the purchase and
 * release flows run without LiveKit credentials while keeping the same contract.
 */
export class FakeSipProvisioner implements SipProvisioner {
  readonly configured = false;
  readonly sipEndpoint = "fake.sip.livekit.cloud";
  private counter = 1;
  private readonly webhookSecret: string;

  constructor(webhookSecret = "fake-livekit-webhook") {
    this.webhookSecret = webhookSecret;
  }

  async provisionNumber(input: ProvisionNumberInput): Promise<ProvisionedRoute> {
    const suffix = this.counter++;
    return {
      trunkId: `fake_trunk_${suffix}`,
      dispatchRuleId: `fake_rule_${suffix}`,
      roomPrefix: inboundRoomPrefix(input.numberId),
      configured: false,
    };
  }

  async deprovisionNumber(input: {
    trunkId?: string | null;
    dispatchRuleId?: string | null;
  }): Promise<void> {
    void input;
  }

  async verifyWebhook(rawBody: string, authHeader?: string): Promise<WebhookEvent | null> {
    void rawBody;
    void authHeader;
    void this.webhookSecret;
    return null;
  }

  async mintJoinToken(input: { roomName: string; identity: string; name?: string }): Promise<string> {
    return `fake-token:${input.roomName}:${input.identity}`;
  }

  async removeParticipant(roomName: string, identity: string): Promise<void> {
    void roomName;
    void identity;
  }

  async endRoom(roomName: string): Promise<void> {
    void roomName;
  }
}

export function createSipProvisioner(config: LiveKitProvisionerConfig): SipProvisioner {
  if (
    config.url &&
    config.apiKey &&
    config.apiSecret &&
    config.sipEndpoint
  ) {
    return new LiveKitSipProvisioner({
      ...config,
      url: config.url,
      apiKey: config.apiKey,
      apiSecret: config.apiSecret,
      sipEndpoint: config.sipEndpoint,
    });
  }
  return new FakeSipProvisioner();
}
