import { randomBytes, randomUUID } from "node:crypto";
import dgram from "node:dgram";
import net from "node:net";

export type SipProbeTransport = "udp" | "tcp";

export type SipProbeOptions = {
  host: string;
  port?: number;
  transport?: SipProbeTransport;
  timeoutMs?: number;
  /** Source host written into the Via/From headers. Defaults to a documentation address. */
  localHost?: string;
};

export type SipProbeResult = {
  /** Any well-formed SIP response was received. */
  reachable: boolean;
  statusCode: number | null;
  statusText: string | null;
  latencyMs: number | null;
  server: string | null;
  allow: string | null;
  error: string | null;
};

export function buildOptionsRequest(input: {
  host: string;
  port: number;
  transport: SipProbeTransport;
  localHost: string;
  callId?: string;
}): string {
  const branch = `z9hG4bK${randomBytes(6).toString("hex")}`;
  const tag = randomBytes(4).toString("hex");
  const callId = input.callId ?? `${randomUUID()}@${input.localHost}`;
  const hostPart = input.host.includes(":") ? `[${input.host}]` : input.host;
  return [
    `OPTIONS sip:${hostPart}:${input.port} SIP/2.0`,
    `Via: SIP/2.0/${input.transport.toUpperCase()} ${input.localHost}:5060;branch=${branch};rport`,
    "Max-Forwards: 70",
    `From: <sip:probe@${input.localHost}>;tag=${tag}`,
    `To: <sip:${hostPart}:${input.port}>`,
    `Call-ID: ${callId}`,
    "CSeq: 1 OPTIONS",
    `Contact: <sip:probe@${input.localHost}:5060>`,
    "User-Agent: quickstart-sip-probe",
    "Accept: application/sdp",
    "Content-Length: 0",
    "",
    "",
  ].join("\r\n");
}

export function parseSipResponse(raw: string): Omit<SipProbeResult, "latencyMs" | "error"> | null {
  const lines = raw.split(/\r?\n/);
  const status = /^SIP\/2\.0\s+(\d{3})\s*(.*)$/.exec(lines[0] ?? "");
  if (!status) return null;
  const header = (name: string): string | null => {
    const prefix = `${name.toLowerCase()}:`;
    const line = lines.find((entry) => entry.toLowerCase().startsWith(prefix));
    return line ? line.slice(prefix.length).trim() : null;
  };
  return {
    reachable: true,
    statusCode: Number(status[1]),
    statusText: status[2]?.trim() || null,
    server: header("server") ?? header("user-agent"),
    allow: header("allow"),
  };
}

/**
 * Send a SIP OPTIONS ping. OPTIONS never creates a call, so it is a safe way to prove
 * that a SIP edge is reachable from where the probe runs (firewall, NAT, DNS, TLS-less
 * listener). Any SIP response, even 4xx, means the signalling path is open.
 */
export function probeSipOptions(options: SipProbeOptions): Promise<SipProbeResult> {
  const transport = options.transport ?? "udp";
  const port = options.port ?? 5060;
  const timeoutMs = options.timeoutMs ?? 3000;
  const request = buildOptionsRequest({
    host: options.host,
    port,
    transport,
    localHost: options.localHost ?? "192.0.2.1",
  });
  const started = Date.now();

  const fail = (error: string): SipProbeResult => ({
    reachable: false,
    statusCode: null,
    statusText: null,
    latencyMs: null,
    server: null,
    allow: null,
    error,
  });

  return new Promise<SipProbeResult>((resolve) => {
    let settled = false;
    const finish = (result: SipProbeResult, cleanup: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      cleanup();
      resolve(result);
    };
    let cleanup: () => void = () => undefined;
    const timer = setTimeout(
      () => finish(fail(`No SIP response within ${timeoutMs} ms (${transport})`), cleanup),
      timeoutMs,
    );

    const accept = (data: Buffer) => {
      const parsed = parseSipResponse(data.toString("utf8"));
      if (!parsed) return;
      finish({ ...parsed, latencyMs: Date.now() - started, error: null }, cleanup);
    };

    if (transport === "udp") {
      const family = net.isIPv6(options.host) ? "udp6" : "udp4";
      const socket = dgram.createSocket(family);
      cleanup = () => socket.close();
      socket.on("message", accept);
      socket.on("error", (err) => finish(fail(err.message), cleanup));
      socket.send(request, port, options.host, (err) => {
        if (err) finish(fail(err.message), cleanup);
      });
    } else {
      const socket = net.connect({ host: options.host, port });
      cleanup = () => socket.destroy();
      let buffer = "";
      socket.on("connect", () => socket.write(request));
      socket.on("data", (data) => {
        buffer += data.toString("utf8");
        if (buffer.includes("\r\n\r\n")) accept(Buffer.from(buffer));
      });
      socket.on("error", (err) => finish(fail(err.message), cleanup));
      socket.on("close", () => finish(fail("Connection closed before a SIP response"), cleanup));
    }
  });
}
