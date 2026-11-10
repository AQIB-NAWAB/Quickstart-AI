import { isIP } from "node:net";
import type { InboundSetupInfo, SipSetupCheck, SipInboundMode } from "@quickstart/contracts";
import type { SipProvisioner } from "../telephony/livekit/sip-provisioner.js";
import type { SipEdgeConfig } from "../telephony/sip-edge.js";

export type InboundSetupDeps = {
  mode: SipInboundMode;
  provisioner: SipProvisioner;
  edge: SipEdgeConfig;
  publicBaseUrl: string;
  /** `LIVEKIT_BRIDGE_ENABLED` resolved against LiveKit credentials. */
  bridgeEnabled: boolean;
  /** The media bridge was actually constructed (needs a live speech pipeline). */
  bridgeActive: boolean;
  /** A live STT/TTS or realtime speech pipeline is configured. */
  speechPipelineReady: boolean;
  /** Platform carrier (Telnyx) purchase flow is enabled. */
  purchaseAvailable: boolean;
};

function isPrivateOrLocalHost(host: string): boolean {
  const value = host.toLowerCase();
  if (value === "localhost" || value.endsWith(".local") || value.endsWith(".internal")) return true;
  const family = isIP(value);
  if (family === 4) {
    const [a, b] = value.split(".").map(Number);
    return (
      a === 10 ||
      a === 127 ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 169 && b === 254)
    );
  }
  if (family === 6) return value === "::1" || value.startsWith("fc") || value.startsWith("fd") || value.startsWith("fe80");
  return false;
}

function check(
  id: string,
  label: string,
  status: SipSetupCheck["status"],
  detail: string,
): SipSetupCheck {
  return { id, label, status, detail };
}

/** Pure-ish readiness report: only the LiveKit API probe performs I/O. */
export async function buildInboundSetup(deps: InboundSetupDeps): Promise<InboundSetupInfo> {
  const { provisioner, edge, mode } = deps;
  const checks: SipSetupCheck[] = [];

  if (!provisioner.configured) {
    checks.push(
      check(
        "livekit_configured",
        "LiveKit SIP configured",
        "error",
        "Set LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET and LIVEKIT_SIP_ENDPOINT. Until then telephony is simulated and no real call can arrive.",
      ),
    );
  } else {
    checks.push(
      check(
        "livekit_configured",
        "LiveKit SIP configured",
        "ok",
        mode === "livekit_cloud" ? "Using LiveKit Cloud SIP." : "Using a self-hosted LiveKit SIP stack.",
      ),
    );
    const api = await provisioner.checkConnection();
    checks.push(check("livekit_api", "LiveKit API reachable", api.ok ? "ok" : "error", api.detail));
  }

  if (!edge.host) {
    checks.push(
      check(
        "sip_host",
        "Public SIP host",
        "error",
        "LIVEKIT_SIP_ENDPOINT is empty; operators have nowhere to point their trunk.",
      ),
    );
  } else if (isPrivateOrLocalHost(edge.host)) {
    checks.push(
      check(
        "sip_host",
        "Public SIP host",
        "warn",
        `${edge.host} is a private address. Only trunks inside the same network can reach it; use a public hostname or IP for carriers.`,
      ),
    );
  } else {
    checks.push(check("sip_host", "Public SIP host", "ok", `Carriers deliver calls to ${edge.host}:${edge.port}.`));
  }

  let webhookHost = "";
  try {
    webhookHost = new URL(deps.publicBaseUrl).hostname;
  } catch {
    webhookHost = "";
  }
  if (!webhookHost) {
    checks.push(
      check("webhook_url", "Webhook URL", "error", "VOICE_PUBLIC_BASE_URL is not a valid URL."),
    );
  } else if (isPrivateOrLocalHost(webhookHost)) {
    checks.push(
      check(
        "webhook_url",
        "LiveKit webhook reachable",
        "warn",
        `VOICE_PUBLIC_BASE_URL (${deps.publicBaseUrl}) is local or private. LiveKit must be able to POST room events to it; use a public HTTPS URL or a tunnel when LiveKit runs elsewhere.`,
      ),
    );
  } else if (!deps.publicBaseUrl.startsWith("https://")) {
    checks.push(
      check(
        "webhook_url",
        "LiveKit webhook reachable",
        "warn",
        "VOICE_PUBLIC_BASE_URL is not HTTPS. Webhooks are signed, but TLS is recommended in production.",
      ),
    );
  } else {
    checks.push(check("webhook_url", "LiveKit webhook reachable", "ok", "Public HTTPS webhook URL is configured."));
  }

  if (!deps.speechPipelineReady) {
    checks.push(
      check(
        "speech",
        "Speech pipeline",
        "error",
        "No live speech pipeline. Configure DEEPGRAM_API_KEY with a TTS provider, or a realtime provider (OpenAI, Gemini, ElevenLabs).",
      ),
    );
  } else {
    checks.push(check("speech", "Speech pipeline", "ok", "Live speech pipeline is configured."));
  }

  if (!deps.bridgeEnabled) {
    checks.push(
      check(
        "bridge",
        "Inbound media bridge",
        "error",
        "The bridge is disabled (LIVEKIT_BRIDGE_ENABLED=0 or LiveKit is not configured), so callers would hear silence.",
      ),
    );
  } else if (!deps.bridgeActive) {
    checks.push(
      check(
        "bridge",
        "Inbound media bridge",
        "error",
        "The bridge could not start because the speech pipeline is unavailable.",
      ),
    );
  } else {
    checks.push(check("bridge", "Inbound media bridge", "ok", "Bridge joins each call room and runs the agent."));
  }

  if (mode === "self_hosted") {
    if (edge.tlsPort === null) {
      checks.push(
        check(
          "sip_tls",
          "SIP over TLS",
          "warn",
          "TLS (SIPS) is not enabled. Signalling is unencrypted; fine on a private network, enable it for public carriers.",
        ),
      );
    } else {
      checks.push(check("sip_tls", "SIP over TLS", "ok", `SIPS is advertised on port ${edge.tlsPort}.`));
    }
  }

  return {
    mode,
    configured: provisioner.configured,
    purchase_available: deps.purchaseAvailable,
    byo_sip_available: true,
    ready: !checks.some((entry) => entry.status === "error"),
    connection: {
      host: edge.host,
      port: edge.port,
      tls_port: edge.tlsPort,
      transports: edge.transports,
      codecs: ["PCMU", "PCMA"],
      dtmf: "rfc2833",
      rtp_port_range: edge.rtpPortRange,
      server_ips: edge.serverIps,
    },
    webhooks: {
      livekit: `${deps.publicBaseUrl}/voice/telephony/livekit/webhook`,
      telnyx: `${deps.publicBaseUrl}/voice/telephony/telnyx/webhook`,
    },
    checks,
  };
}
