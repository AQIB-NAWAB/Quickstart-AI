import type { Logger } from "@quickstart/logging";
import { FakeCpaasProvider } from "./fake-cpaas.js";
import { SipBridgeProvider } from "./sip-provider.js";
import { TwilioCpaasProvider } from "./twilio-cpaas.js";
import { TelephonyRouter } from "./router.js";
import { TelnyxClient } from "./telnyx/client.js";
import { DisabledTelnyxClient } from "./telnyx/disabled-client.js";
import { FakeTelnyxClient } from "./telnyx/fake-client.js";
import { TelnyxProvider } from "./telnyx/provider.js";
import type { TelnyxNumbersClient } from "./telnyx/types.js";
import type { TelephonyProvider } from "./types.js";

export type TelephonyProfile = "fake" | "twilio" | "telnyx" | "sip";

export type CreateTelephonyRouterInput = {
  profile: TelephonyProfile;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  twilioFromNumber?: string;
  telnyxApiKey?: string;
  telnyxPublicKey?: string;
  telnyxFromNumber?: string;
  telnyxWebhookToleranceSec?: number;
  livekitConfigured?: boolean;
  publicBaseUrl: string;
  sipBridgeSharedSecret: string;
  requireRealTelephony: boolean;
  logger?: Logger;
  fetchImpl?: typeof fetch;
};

export function assertTelephonyBootAllowed(input: {
  profile: TelephonyProfile;
  twilioAccountSid?: string;
  twilioAuthToken?: string;
  telnyxApiKey?: string;
  telnyxPublicKey?: string;
  livekitConfigured?: boolean;
  requireRealTelephony: boolean;
}): void {
  if (!input.requireRealTelephony) return;
  if (input.profile === "fake") {
    throw new Error(
      "TELEPHONY_REQUIRE_REAL=1 forbids TELEPHONY_PROFILE=fake; set TELEPHONY_PROFILE=telnyx, twilio, or sip and credentials",
    );
  }
  if (input.profile === "twilio" && (!input.twilioAccountSid || !input.twilioAuthToken)) {
    throw new Error(
      "TELEPHONY_REQUIRE_REAL=1 requires TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN",
    );
  }
  if (input.profile === "telnyx") {
    const missing: string[] = [];
    if (!input.telnyxApiKey) missing.push("TELNYX_API_KEY");
    if (!input.telnyxPublicKey) missing.push("TELNYX_PUBLIC_KEY");
    if (!input.livekitConfigured) {
      missing.push("LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET", "LIVEKIT_SIP_ENDPOINT");
    }
    if (missing.length > 0) {
      throw new Error(
        `TELEPHONY_REQUIRE_REAL=1 with TELEPHONY_PROFILE=telnyx requires ${missing.join(", ")}`,
      );
    }
  }
  if (input.profile === "sip") {
    if (!input.livekitConfigured) {
      throw new Error(
        "TELEPHONY_REQUIRE_REAL=1 with TELEPHONY_PROFILE=sip requires LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and LIVEKIT_SIP_ENDPOINT",
      );
    }
  }
}

function createTwilioProvider(input: CreateTelephonyRouterInput): TelephonyProvider {
  const sid = input.twilioAccountSid;
  const token = input.twilioAuthToken;
  if (!sid || !token) {
    throw new Error("TELEPHONY_PROFILE=twilio requires TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN");
  }
  return new TwilioCpaasProvider({
    accountSid: sid,
    authToken: token,
    fromNumber: input.twilioFromNumber ?? "",
    publicBaseUrl: input.publicBaseUrl.replace(/\/$/, ""),
    fetchImpl: input.fetchImpl,
  });
}

/**
 * Build a TelephonyRouter with swappable adapters.
 * - profile=fake: fake Twilio/Telnyx adapters (local / CI)
 * - profile=twilio: real Twilio; Telnyx is a fake fallback
 * - profile=telnyx: real Telnyx inbound (media handled by LiveKit SIP)
 * - profile=sip: LiveKit-only inbound (customers bring their own numbers/trunks; purchase disabled)
 * SIP bridge is always registered.
 */
export function createTelephonyRouter(input: CreateTelephonyRouterInput): {
  router: TelephonyRouter;
  sip: SipBridgeProvider;
  twilio: TelephonyProvider;
  telnyx: TelephonyProvider;
  telnyxClient: TelnyxNumbersClient;
} {
  assertTelephonyBootAllowed(input);

  const router = new TelephonyRouter();
  const sip = new SipBridgeProvider(input.sipBridgeSharedSecret);

  let twilio: TelephonyProvider;
  if (input.profile === "twilio") {
    twilio = createTwilioProvider(input);
  } else {
    twilio = new FakeCpaasProvider("twilio");
  }

  let telnyxClient: TelnyxNumbersClient;
  if (input.profile === "telnyx") {
    if (!input.telnyxApiKey || !input.telnyxPublicKey) {
      throw new Error("TELEPHONY_PROFILE=telnyx requires TELNYX_API_KEY and TELNYX_PUBLIC_KEY");
    }
    if (!input.livekitConfigured) {
      throw new Error(
        "TELEPHONY_PROFILE=telnyx requires LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET, and LIVEKIT_SIP_ENDPOINT",
      );
    }
    telnyxClient = new TelnyxClient({
      apiKey: input.telnyxApiKey,
      publicKey: input.telnyxPublicKey,
      webhookToleranceSec: input.telnyxWebhookToleranceSec,
      fetchImpl: input.fetchImpl,
    });
  } else if (input.profile === "sip") {
    telnyxClient = new DisabledTelnyxClient();
  } else {
    telnyxClient = new FakeTelnyxClient();
  }
  const telnyx = new TelnyxProvider(telnyxClient, input.telnyxFromNumber ?? "");

  router.register(twilio);
  router.register(telnyx);
  router.register(sip);
  router.register(new FakeCpaasProvider("fake"));

  input.logger?.info("telephony.profile", {
    profile: input.profile,
    twilio_adapter: twilio instanceof TwilioCpaasProvider ? "twilio-cpaas" : "fake-cpaas",
    telnyx_adapter:
      telnyxClient instanceof DisabledTelnyxClient
        ? "disabled-telnyx"
        : telnyxClient.kind === "telnyx"
          ? "telnyx-client"
          : "fake-telnyx",
    livekit: Boolean(input.livekitConfigured),
  });

  return { router, sip, twilio, telnyx, telnyxClient };
}

export function resolveTelephonyProfile(
  rawProfile: string | undefined,
  hasTwilioCreds: boolean,
  hasTelnyxCreds = false,
  hasLivekitCreds = false,
): TelephonyProfile {
  const value = (rawProfile ?? "").trim().toLowerCase();
  if (value === "twilio") return "twilio";
  if (value === "telnyx") return "telnyx";
  if (value === "sip") return "sip";
  if (value === "fake") return "fake";
  // Auto: real Telnyx wins over Twilio when both are configured because the
  // inbound LiveKit path is Telnyx-first.
  if (!value && hasTelnyxCreds) return "telnyx";
  if (!value && hasLivekitCreds && !hasTwilioCreds) return "sip";
  if (!value && hasTwilioCreds) return "twilio";
  return "fake";
}
