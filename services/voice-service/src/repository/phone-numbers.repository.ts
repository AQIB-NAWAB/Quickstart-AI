import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import type {
  AvailablePhoneNumber,
  ByoSipSummary,
  PhoneNumberCapabilities,
  PhoneNumberStatus,
  PhoneNumberType,
  WorkspacePhoneNumber,
} from "@quickstart/contracts";

export type PhoneNumberRow = {
  id: string;
  workspace_id: string | null;
  phone_number: string;
  friendly_name: string | null;
  provider: string;
  provider_sid: string | null;
  provider_number_id: string | null;
  provider_connection_id: string | null;
  assigned_agent_id: string | null;
  inbound_webhook_url: string | null;
  status: PhoneNumberStatus;
  inbound_status: PhoneNumberStatus;
  livekit_trunk_id: string | null;
  livekit_dispatch_rule_id: string | null;
  country_code: string | null;
  number_type: PhoneNumberType | null;
  region: string | null;
  locality: string | null;
  monthly_cost: number | null;
  currency: string | null;
  capabilities: PhoneNumberCapabilities;
  provisioning_error: string | null;
  purchased_at: Date | null;
  released_at: Date | null;
  created_at: Date;
  updated_at: Date;
  metadata: Record<string, unknown>;
};

export type CreatePhoneNumberInput = {
  id?: string;
  workspaceId?: string | null;
  phoneNumber: string;
  friendlyName?: string | null;
  provider: string;
  providerSid?: string | null;
  providerNumberId?: string | null;
  providerConnectionId?: string | null;
  assignedAgentId?: string | null;
  status?: PhoneNumberStatus;
  inboundStatus?: PhoneNumberStatus;
  livekitTrunkId?: string | null;
  livekitDispatchRuleId?: string | null;
  countryCode?: string | null;
  numberType?: PhoneNumberType | null;
  region?: string | null;
  locality?: string | null;
  monthlyCost?: number | null;
  currency?: string | null;
  capabilities?: PhoneNumberCapabilities;
  provisioningError?: string | null;
  purchasedAt?: Date | null;
  metadata?: Record<string, unknown>;
};

export type UpdatePhoneNumberPatch = {
  workspaceId?: string | null;
  friendlyName?: string | null;
  providerSid?: string | null;
  providerNumberId?: string | null;
  providerConnectionId?: string | null;
  assignedAgentId?: string | null;
  status?: PhoneNumberStatus;
  inboundStatus?: PhoneNumberStatus;
  livekitTrunkId?: string | null;
  livekitDispatchRuleId?: string | null;
  provisioningError?: string | null;
  purchasedAt?: Date | null;
  releasedAt?: Date | null;
  metadata?: Record<string, unknown>;
};

export interface PhoneNumbersRepository {
  listForWorkspace(workspaceId: string): Promise<PhoneNumberRow[]>;
  listPool(): Promise<PhoneNumberRow[]>;
  getById(id: string): Promise<PhoneNumberRow | null>;
  getByE164(e164: string): Promise<PhoneNumberRow | null>;
  findActiveByE164(e164: string): Promise<PhoneNumberRow | null>;
  create(input: CreatePhoneNumberInput): Promise<PhoneNumberRow>;
  update(id: string, patch: UpdatePhoneNumberPatch): Promise<PhoneNumberRow | null>;
  delete(id: string): Promise<void>;
  getConfig(key: string): Promise<Record<string, unknown> | null>;
  setConfig(key: string, value: Record<string, unknown>): Promise<void>;
}

const PATCH_COLUMNS: Record<keyof UpdatePhoneNumberPatch, string> = {
  workspaceId: "workspace_id",
  friendlyName: "friendly_name",
  providerSid: "provider_sid",
  providerNumberId: "provider_number_id",
  providerConnectionId: "provider_connection_id",
  assignedAgentId: "assigned_agent_id",
  status: "status",
  inboundStatus: "inbound_status",
  livekitTrunkId: "livekit_trunk_id",
  livekitDispatchRuleId: "livekit_dispatch_rule_id",
  provisioningError: "provisioning_error",
  purchasedAt: "purchased_at",
  releasedAt: "released_at",
  metadata: "metadata",
};

const JSON_PATCH_KEYS = new Set<keyof UpdatePhoneNumberPatch>(["metadata"]);

function normalizeCapabilities(raw: unknown): PhoneNumberCapabilities {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    const value = raw as Record<string, unknown>;
    return {
      voice: value.voice !== false,
      sms: value.sms === true,
    };
  }
  return { voice: true, sms: false };
}

function normalizeMetadata(raw: unknown): Record<string, unknown> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as Record<string, unknown>;
  }
  return {};
}

/** Stored under `metadata.byo_sip`; never contains the trunk password. */
export function byoSipSummary(row: Pick<PhoneNumberRow, "provider" | "metadata">): ByoSipSummary | null {
  if (row.provider !== "byo_sip") return null;
  const raw = row.metadata.byo_sip;
  const value = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const allowed = Array.isArray(value.allowed_addresses)
    ? value.allowed_addresses.filter((entry): entry is string => typeof entry === "string")
    : [];
  const username = typeof value.auth_username === "string" ? value.auth_username : null;
  return {
    allowed_addresses: allowed,
    auth_username: username,
    has_credentials: value.has_credentials === true || Boolean(username),
  };
}

export function toWorkspacePhoneNumber(row: PhoneNumberRow): WorkspacePhoneNumber {
  return {
    id: row.id,
    workspace_id: row.workspace_id,
    phone_number: row.phone_number,
    friendly_name: row.friendly_name,
    provider: row.provider,
    provider_number_id: row.provider_number_id,
    provider_connection_id: row.provider_connection_id,
    assigned_agent_id: row.assigned_agent_id,
    status: row.status,
    inbound_status: row.inbound_status,
    livekit_trunk_id: row.livekit_trunk_id,
    livekit_dispatch_rule_id: row.livekit_dispatch_rule_id,
    country_code: row.country_code,
    number_type: row.number_type,
    region: row.region,
    locality: row.locality,
    monthly_cost: row.monthly_cost,
    currency: row.currency,
    capabilities: row.capabilities,
    provisioning_error: row.provisioning_error,
    purchased_at: row.purchased_at?.toISOString() ?? null,
    released_at: row.released_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
    updated_at: row.updated_at.toISOString(),
    sip: byoSipSummary(row),
  };
}

export function availableFromOwned(row: PhoneNumberRow): AvailablePhoneNumber {
  return {
    phone_number: row.phone_number,
    country_code: row.country_code ?? "US",
    number_type: row.number_type ?? "local",
    region: row.region,
    locality: row.locality,
    monthly_cost: row.monthly_cost,
    currency: row.currency,
    owned: true,
    number_id: row.id,
  };
}

type RawRow = {
  id: string;
  workspace_id: string | null;
  phone_number: string;
  friendly_name: string | null;
  provider: string;
  provider_sid: string | null;
  provider_number_id: string | null;
  provider_connection_id: string | null;
  assigned_agent_id: string | null;
  inbound_webhook_url: string | null;
  status: string;
  inbound_status: string;
  livekit_trunk_id: string | null;
  livekit_dispatch_rule_id: string | null;
  country_code: string | null;
  number_type: string | null;
  region: string | null;
  locality: string | null;
  monthly_cost: string | number | null;
  currency: string | null;
  capabilities: unknown;
  provisioning_error: string | null;
  purchased_at: Date | null;
  released_at: Date | null;
  created_at: Date;
  updated_at: Date;
  metadata: unknown;
};

function normalizeRow(row: RawRow): PhoneNumberRow {
  return {
    ...row,
    status: row.status as PhoneNumberStatus,
    inbound_status: row.inbound_status as PhoneNumberStatus,
    number_type: (row.number_type as PhoneNumberType | null) ?? null,
    monthly_cost: row.monthly_cost == null ? null : Number(row.monthly_cost),
    capabilities: normalizeCapabilities(row.capabilities),
    metadata: normalizeMetadata(row.metadata),
  };
}

export class PgPhoneNumbersRepository implements PhoneNumbersRepository {
  constructor(private readonly pool: Pool) {}

  async listForWorkspace(workspaceId: string): Promise<PhoneNumberRow[]> {
    const { rows } = await this.pool.query<RawRow>(
      `SELECT * FROM workspace_phone_numbers
       WHERE workspace_id = $1
       ORDER BY created_at DESC`,
      [workspaceId],
    );
    return rows.map(normalizeRow);
  }

  async listPool(): Promise<PhoneNumberRow[]> {
    const { rows } = await this.pool.query<RawRow>(
      `SELECT * FROM workspace_phone_numbers
       WHERE workspace_id IS NULL AND status = 'active'
       ORDER BY created_at DESC`,
    );
    return rows.map(normalizeRow);
  }

  async getById(id: string): Promise<PhoneNumberRow | null> {
    const { rows } = await this.pool.query<RawRow>(
      `SELECT * FROM workspace_phone_numbers WHERE id = $1`,
      [id],
    );
    return rows[0] ? normalizeRow(rows[0]) : null;
  }

  async getByE164(e164: string): Promise<PhoneNumberRow | null> {
    const { rows } = await this.pool.query<RawRow>(
      `SELECT * FROM workspace_phone_numbers WHERE phone_number = $1`,
      [e164],
    );
    return rows[0] ? normalizeRow(rows[0]) : null;
  }

  async findActiveByE164(e164: string): Promise<PhoneNumberRow | null> {
    const { rows } = await this.pool.query<RawRow>(
      `SELECT * FROM workspace_phone_numbers
       WHERE phone_number = $1 AND status = 'active'
       ORDER BY created_at DESC
       LIMIT 1`,
      [e164],
    );
    return rows[0] ? normalizeRow(rows[0]) : null;
  }

  async create(input: CreatePhoneNumberInput): Promise<PhoneNumberRow> {
    const { rows } = await this.pool.query<RawRow>(
      `INSERT INTO workspace_phone_numbers (
        id, workspace_id, phone_number, friendly_name, provider, provider_sid,
        provider_number_id, provider_connection_id, assigned_agent_id,
        status, inbound_status, livekit_trunk_id, livekit_dispatch_rule_id,
        country_code, number_type, region, locality, monthly_cost, currency,
        capabilities, provisioning_error, purchased_at, metadata
      ) VALUES (
        $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23
      )
      RETURNING *`,
      [
        input.id ?? randomUUID(),
        input.workspaceId ?? null,
        input.phoneNumber,
        input.friendlyName ?? null,
        input.provider,
        input.providerSid ?? null,
        input.providerNumberId ?? null,
        input.providerConnectionId ?? null,
        input.assignedAgentId ?? null,
        input.status ?? "provisioning",
        input.inboundStatus ?? "provisioning",
        input.livekitTrunkId ?? null,
        input.livekitDispatchRuleId ?? null,
        input.countryCode ?? null,
        input.numberType ?? null,
        input.region ?? null,
        input.locality ?? null,
        input.monthlyCost ?? null,
        input.currency ?? null,
        JSON.stringify(input.capabilities ?? { voice: true, sms: false }),
        input.provisioningError ?? null,
        input.purchasedAt ?? null,
        JSON.stringify(input.metadata ?? {}),
      ],
    );
    return normalizeRow(rows[0]);
  }

  async update(id: string, patch: UpdatePhoneNumberPatch): Promise<PhoneNumberRow | null> {
    const entries = Object.entries(patch).filter(([, value]) => value !== undefined);
    if (entries.length === 0) return this.getById(id);

    const params: unknown[] = [id];
    const set: string[] = [];
    for (const [key, value] of entries) {
      const typedKey = key as keyof UpdatePhoneNumberPatch;
      const column = PATCH_COLUMNS[typedKey];
      params.push(JSON_PATCH_KEYS.has(typedKey) ? JSON.stringify(value) : value);
      set.push(`${column} = $${params.length}`);
    }
    set.push("updated_at = NOW()");
    const { rows } = await this.pool.query<RawRow>(
      `UPDATE workspace_phone_numbers SET ${set.join(", ")} WHERE id = $1 RETURNING *`,
      params,
    );
    return rows[0] ? normalizeRow(rows[0]) : null;
  }

  async delete(id: string): Promise<void> {
    await this.pool.query(`DELETE FROM workspace_phone_numbers WHERE id = $1`, [id]);
  }

  async getConfig(key: string): Promise<Record<string, unknown> | null> {
    const { rows } = await this.pool.query<{ value: unknown }>(
      `SELECT value FROM voice_platform_config WHERE key = $1`,
      [key],
    );
    return rows[0] ? normalizeMetadata(rows[0].value) : null;
  }

  async setConfig(key: string, value: Record<string, unknown>): Promise<void> {
    await this.pool.query(
      `INSERT INTO voice_platform_config (key, value, updated_at)
       VALUES ($1, $2, NOW())
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW()`,
      [key, JSON.stringify(value)],
    );
  }
}

export class MemoryPhoneNumbersRepository implements PhoneNumbersRepository {
  private readonly rows = new Map<string, PhoneNumberRow>();
  private readonly config = new Map<string, Record<string, unknown>>();

  async listForWorkspace(workspaceId: string): Promise<PhoneNumberRow[]> {
    return [...this.rows.values()]
      .filter((row) => row.workspace_id === workspaceId)
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }

  async listPool(): Promise<PhoneNumberRow[]> {
    return [...this.rows.values()]
      .filter((row) => row.workspace_id === null && row.status === "active")
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }

  async getById(id: string): Promise<PhoneNumberRow | null> {
    return this.rows.get(id) ?? null;
  }

  async getByE164(e164: string): Promise<PhoneNumberRow | null> {
    return [...this.rows.values()].find((row) => row.phone_number === e164) ?? null;
  }

  async findActiveByE164(e164: string): Promise<PhoneNumberRow | null> {
    return (
      [...this.rows.values()].find(
        (row) => row.phone_number === e164 && row.status === "active",
      ) ?? null
    );
  }

  async create(input: CreatePhoneNumberInput): Promise<PhoneNumberRow> {
    const now = new Date();
    const row: PhoneNumberRow = {
      id: input.id ?? randomUUID(),
      workspace_id: input.workspaceId ?? null,
      phone_number: input.phoneNumber,
      friendly_name: input.friendlyName ?? null,
      provider: input.provider,
      provider_sid: input.providerSid ?? null,
      provider_number_id: input.providerNumberId ?? null,
      provider_connection_id: input.providerConnectionId ?? null,
      assigned_agent_id: input.assignedAgentId ?? null,
      inbound_webhook_url: null,
      status: input.status ?? "provisioning",
      inbound_status: input.inboundStatus ?? "provisioning",
      livekit_trunk_id: input.livekitTrunkId ?? null,
      livekit_dispatch_rule_id: input.livekitDispatchRuleId ?? null,
      country_code: input.countryCode ?? null,
      number_type: input.numberType ?? null,
      region: input.region ?? null,
      locality: input.locality ?? null,
      monthly_cost: input.monthlyCost ?? null,
      currency: input.currency ?? null,
      capabilities: input.capabilities ?? { voice: true, sms: false },
      provisioning_error: input.provisioningError ?? null,
      purchased_at: input.purchasedAt ?? null,
      released_at: null,
      created_at: now,
      updated_at: now,
      metadata: input.metadata ?? {},
    };
    this.rows.set(row.id, row);
    return row;
  }

  async update(id: string, patch: UpdatePhoneNumberPatch): Promise<PhoneNumberRow | null> {
    const row = this.rows.get(id);
    if (!row) return null;
    const next: PhoneNumberRow = { ...row, updated_at: new Date() };
    if (patch.workspaceId !== undefined) next.workspace_id = patch.workspaceId;
    if (patch.friendlyName !== undefined) next.friendly_name = patch.friendlyName;
    if (patch.providerSid !== undefined) next.provider_sid = patch.providerSid;
    if (patch.providerNumberId !== undefined) next.provider_number_id = patch.providerNumberId;
    if (patch.providerConnectionId !== undefined) {
      next.provider_connection_id = patch.providerConnectionId;
    }
    if (patch.assignedAgentId !== undefined) next.assigned_agent_id = patch.assignedAgentId;
    if (patch.status !== undefined) next.status = patch.status;
    if (patch.inboundStatus !== undefined) next.inbound_status = patch.inboundStatus;
    if (patch.livekitTrunkId !== undefined) next.livekit_trunk_id = patch.livekitTrunkId;
    if (patch.livekitDispatchRuleId !== undefined) {
      next.livekit_dispatch_rule_id = patch.livekitDispatchRuleId;
    }
    if (patch.provisioningError !== undefined) next.provisioning_error = patch.provisioningError;
    if (patch.purchasedAt !== undefined) next.purchased_at = patch.purchasedAt;
    if (patch.releasedAt !== undefined) next.released_at = patch.releasedAt;
    if (patch.metadata !== undefined) next.metadata = patch.metadata;
    this.rows.set(id, next);
    return next;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }

  async getConfig(key: string): Promise<Record<string, unknown> | null> {
    const value = this.config.get(key);
    return value ? { ...value } : null;
  }

  async setConfig(key: string, value: Record<string, unknown>): Promise<void> {
    this.config.set(key, { ...value });
  }
}
