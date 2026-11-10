import { randomBytes } from "node:crypto";
import { isIP } from "node:net";
import { AppError, ErrorCode } from "@quickstart/errors";
import type {
  SipConnectionInfo,
  SipInboundMode,
  SipTransport,
} from "@quickstart/contracts";

/** Codecs the LiveKit SIP edge negotiates for PSTN-grade audio. */
export const SIP_CODECS = ["PCMU", "PCMA"] as const;

export const MAX_ALLOWED_ADDRESSES = 32;
const MIN_IPV4_PREFIX = 16;
const MIN_IPV6_PREFIX = 48;
const USERNAME_PATTERN = /^[A-Za-z0-9._-]{3,64}$/;

/** Public description of the SIP ingress that carriers and PBXs deliver calls to. */
export type SipEdgeConfig = {
  host: string | null;
  port: number;
  tlsPort: number | null;
  transports: SipTransport[];
  rtpPortRange: string | null;
  serverIps: string[];
};

export type SipEdgeInput = {
  /** `LIVEKIT_SIP_ENDPOINT`: `host`, `host:port`, or `[ipv6]:port`. */
  sipEndpoint?: string;
  port?: number;
  tlsPort?: number | null;
  transports?: SipTransport[];
  rtpPortRange?: string | null;
  serverIps?: string[];
};

export function parseSipEndpoint(raw: string | undefined): { host: string | null; port: number | null } {
  const value = (raw ?? "").trim().replace(/^sips?:/i, "").replace(/\/+$/, "");
  if (!value) return { host: null, port: null };
  const bracketed = /^\[([^\]]+)\](?::(\d{1,5}))?$/.exec(value);
  if (bracketed) {
    return { host: bracketed[1], port: bracketed[2] ? Number(bracketed[2]) : null };
  }
  const hostPort = /^([^:]+):(\d{1,5})$/.exec(value);
  if (hostPort) return { host: hostPort[1], port: Number(hostPort[2]) };
  return { host: value, port: null };
}

export function buildSipEdge(input: SipEdgeInput): SipEdgeConfig {
  const endpoint = parseSipEndpoint(input.sipEndpoint);
  const tlsPort = input.tlsPort ?? null;
  const transports = (input.transports?.length ? input.transports : ["udp", "tcp"]) as SipTransport[];
  const effective = [...new Set(transports)].filter(
    (transport) => transport !== "tls" || tlsPort !== null,
  );
  return {
    host: endpoint.host,
    port: endpoint.port ?? input.port ?? 5060,
    tlsPort,
    transports: effective.length > 0 ? effective : ["udp", "tcp"],
    rtpPortRange: input.rtpPortRange ?? null,
    serverIps: input.serverIps ?? [],
  };
}

export function detectSipMode(sipEndpoint: string | undefined, configured: boolean): SipInboundMode {
  if (!configured) return "not_configured";
  const { host } = parseSipEndpoint(sipEndpoint);
  return host && host.toLowerCase().endsWith(".sip.livekit.cloud") ? "livekit_cloud" : "self_hosted";
}

export function parseSipTransports(raw: string | undefined): SipTransport[] {
  const values = (raw ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry): entry is SipTransport => entry === "udp" || entry === "tcp" || entry === "tls");
  return values.length > 0 ? [...new Set(values)] : ["udp", "tcp"];
}

export function parseList(raw: string | undefined): string[] {
  return (raw ?? "")
    .split(/[\s,]+/)
    .map((entry) => entry.trim())
    .filter(Boolean);
}

/** The called-number forms a PBX or carrier may put in the SIP To / Request-URI. */
export function acceptedNumberFormats(e164: string): string[] {
  return [e164, e164.replace(/^\+/, "")];
}

function invalid(message: string): AppError {
  return new AppError({ code: ErrorCode.VALIDATION_FAILED, message });
}

/**
 * Validate the source addresses a trunk will accept calls from. Only literal IPs and
 * CIDRs are allowed (SIP edges match on the packet source, not DNS names), and very
 * broad ranges are refused so a trunk can never be effectively open to the internet.
 */
export function normalizeAllowedAddresses(input: readonly string[] | undefined): string[] {
  const entries = (input ?? [])
    .flatMap((entry) => String(entry).split(/[\s,]+/))
    .map((entry) => entry.trim())
    .filter(Boolean);
  const unique = [...new Set(entries)];
  if (unique.length > MAX_ALLOWED_ADDRESSES) {
    throw invalid(`At most ${MAX_ALLOWED_ADDRESSES} allowed addresses are supported`);
  }
  for (const entry of unique) {
    const [address, prefixRaw, extra] = entry.split("/");
    if (extra !== undefined) throw invalid(`"${entry}" is not a valid IP address or CIDR`);
    const family = isIP(address ?? "");
    if (family === 0) {
      throw invalid(
        `"${entry}" is not a valid IP address or CIDR. Hostnames are not supported; use the IPs your SIP server sends from.`,
      );
    }
    const max = family === 4 ? 32 : 128;
    if (prefixRaw !== undefined) {
      if (!/^\d{1,3}$/.test(prefixRaw) || Number(prefixRaw) > max) {
        throw invalid(`"${entry}" has an invalid CIDR prefix`);
      }
    }
    const prefix = prefixRaw === undefined ? max : Number(prefixRaw);
    const minimum = family === 4 ? MIN_IPV4_PREFIX : MIN_IPV6_PREFIX;
    if (prefix < minimum) {
      throw invalid(
        `"${entry}" is too broad. Use /${minimum} or narrower so the trunk cannot be reached from arbitrary hosts.`,
      );
    }
    if (family === 4 && address === "0.0.0.0") throw invalid('"0.0.0.0" is not a usable source address');
  }
  return unique;
}

export function validateAuthUsername(username: string): string {
  const value = username.trim();
  if (!USERNAME_PATTERN.test(value)) {
    throw invalid("SIP username must be 3-64 characters: letters, digits, dot, dash or underscore");
  }
  return value;
}

export function generateSipUsername(): string {
  return `qs_${randomBytes(5).toString("hex")}`;
}

/** 192-bit random secret, safe inside a SIP digest challenge. */
export function generateSipPassword(): string {
  return randomBytes(24).toString("base64url");
}

export type ConnectionInfoInput = {
  e164: string;
  allowedAddresses: string[];
  authUsername: string | null;
  authPassword?: string;
};

export function buildConnectionInfo(edge: SipEdgeConfig, input: ConnectionInfoInput): SipConnectionInfo {
  const host = edge.host ?? "<sip-host>";
  const hostPart = host.includes(":") ? `[${host}]` : host;
  return {
    host: edge.host,
    port: edge.port,
    tls_port: edge.tlsPort,
    transports: edge.transports,
    sip_uri: `sip:${input.e164}@${hostPart}:${edge.port}`,
    accepted_number_formats: acceptedNumberFormats(input.e164),
    allowed_addresses: input.allowedAddresses,
    auth_username: input.authUsername,
    ...(input.authPassword ? { auth_password: input.authPassword } : {}),
    codecs: [...SIP_CODECS],
    dtmf: "rfc2833",
    rtp_port_range: edge.rtpPortRange,
    server_ips: edge.serverIps,
  };
}
