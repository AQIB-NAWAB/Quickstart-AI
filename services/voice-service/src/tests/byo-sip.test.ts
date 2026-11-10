import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "@quickstart/errors";
import { createLogger } from "@quickstart/logging";
import { MemoryPhoneNumbersRepository } from "../repository/phone-numbers.repository.js";
import { PhoneNumbersService } from "../services/phone-numbers.service.js";
import { buildInboundSetup } from "../services/inbound-setup.service.js";
import { DisabledTelnyxClient } from "../telephony/telnyx/disabled-client.js";
import { FakeTelnyxClient } from "../telephony/telnyx/fake-client.js";
import {
  FakeSipProvisioner,
  inboundRoomPrefix,
} from "../telephony/livekit/sip-provisioner.js";
import {
  buildOptionsRequest,
  parseSipResponse,
} from "../telephony/sip-probe.js";
import {
  buildSipEdge,
  detectSipMode,
  normalizeAllowedAddresses,
  validateAuthUsername,
} from "../telephony/sip-edge.js";
import {
  assertTelephonyBootAllowed,
  createTelephonyRouter,
  resolveTelephonyProfile,
} from "../telephony/factory.js";

const WS_A = "11111111-1111-4111-8111-111111111111";

function makeService(opts: { disabledTelnyx?: boolean } = {}) {
  const repo = new MemoryPhoneNumbersRepository();
  const telnyx = opts.disabledTelnyx ? new DisabledTelnyxClient() : new FakeTelnyxClient();
  const provisioner = new FakeSipProvisioner();
  const sipEdge = buildSipEdge({
    sipEndpoint: "sip.example.com",
    port: 5060,
    tlsPort: 5061,
    transports: ["udp", "tcp", "tls"],
    rtpPortRange: "10000-20000",
    serverIps: ["203.0.113.10"],
  });
  const service = new PhoneNumbersService({
    repo,
    telnyx,
    provisioner,
    connectionName: "Test Inbound",
    sipEdge,
    logger: createLogger({ service: "byo-sip-test" }),
    orderPollAttempts: 1,
    orderPollIntervalMs: 0,
  });
  return { repo, telnyx, provisioner, sipEdge, service };
}

test("registerByo provisions LiveKit trunk with source IPs and generates credentials", async () => {
  const { service, provisioner, repo } = makeService();

  const result = await service.registerByo(WS_A, {
    e164: "+14155550999",
    agent_id: "agent-byo-1",
    friendly_name: "Customer Asterisk Trunk",
    allowed_addresses: ["203.0.113.50", "198.51.100.0/24"],
    generate_credentials: true,
  });

  assert.equal(result.number.phone_number, "+14155550999");
  assert.equal(result.number.workspace_id, WS_A);
  assert.equal(result.number.provider, "byo_sip");
  assert.equal(result.number.status, "active");
  assert.equal(result.number.inbound_status, "active");
  assert.equal(result.number.assigned_agent_id, "agent-byo-1");
  assert.ok(result.number.livekit_trunk_id);
  assert.ok(result.number.livekit_dispatch_rule_id);

  // Connection info has one-time password
  assert.ok(result.connection.auth_password);
  assert.ok(result.connection.auth_username);
  assert.deepEqual(result.connection.allowed_addresses, ["203.0.113.50", "198.51.100.0/24"]);
  assert.equal(result.connection.host, "sip.example.com");
  assert.equal(result.connection.port, 5060);
  assert.equal(result.connection.tls_port, 5061);
  assert.deepEqual(result.connection.accepted_number_formats, ["+14155550999", "14155550999"]);

  // Fake provisioner stored trunk options
  const fakeTrunk = provisioner.trunks.get(result.number.livekit_trunk_id!);
  assert.ok(fakeTrunk);
  assert.deepEqual(fakeTrunk.allowedAddresses, ["203.0.113.50", "198.51.100.0/24"]);
  assert.equal(fakeTrunk.authUsername, result.connection.auth_username);
  assert.equal(fakeTrunk.authPassword, result.connection.auth_password);

  // Resolution
  const route = await service.resolveInbound("+14155550999");
  assert.deepEqual(route, {
    numberId: result.number.id,
    workspaceId: WS_A,
    agentId: "agent-byo-1",
    e164: "+14155550999",
    roomPrefix: inboundRoomPrefix(result.number.id),
    provider: "byo_sip",
  });

  // Stored metadata in repo does NOT expose the password
  const stored = await repo.getById(result.number.id);
  const byoMeta = stored?.metadata?.byo_sip as Record<string, unknown> | undefined;
  assert.equal(byoMeta?.auth_password, undefined);
});

test("registerByo rejects open trunk without allowed IPs or credentials", async () => {
  const { service } = makeService();

  await assert.rejects(
    () =>
      service.registerByo(WS_A, {
        e164: "+14155550888",
        allowed_addresses: [],
        generate_credentials: false,
      }),
    (err: unknown) => err instanceof AppError && err.code === "VALIDATION_FAILED",
  );
});

test("getSipConnection returns connection details without password", async () => {
  const { service } = makeService();
  const created = await service.registerByo(WS_A, {
    e164: "+14155550777",
    allowed_addresses: ["203.0.113.20"],
    generate_credentials: true,
  });

  const connection = await service.getSipConnection(WS_A, created.number.id);
  assert.equal(connection.auth_password, undefined);
  assert.equal(connection.auth_username, created.connection.auth_username);
  assert.deepEqual(connection.allowed_addresses, ["203.0.113.20"]);
});

test("rotateByoCredentials generates new password and updates LiveKit trunk", async () => {
  const { service, provisioner } = makeService();
  const created = await service.registerByo(WS_A, {
    e164: "+14155550666",
    allowed_addresses: ["203.0.113.30"],
    generate_credentials: true,
  });

  const oldPassword = created.connection.auth_password;
  const rotated = await service.rotateByoCredentials(WS_A, created.number.id);
  assert.ok(rotated.connection.auth_password);
  assert.notEqual(rotated.connection.auth_password, oldPassword);

  const fakeTrunk = provisioner.trunks.get(created.number.livekit_trunk_id!);
  assert.equal(fakeTrunk?.authPassword, rotated.connection.auth_password);
});

test("updateByoAccess updates allowed IPs and forbids removing all IPs if no credentials", async () => {
  const { service, provisioner } = makeService();

  // IP-only trunk
  const created = await service.registerByo(WS_A, {
    e164: "+14155550555",
    allowed_addresses: ["203.0.113.1"],
    generate_credentials: false,
  });

  const updated = await service.updateByoAccess(WS_A, created.number.id, [
    "203.0.113.2",
    "203.0.113.3",
  ]);
  assert.deepEqual(updated.sip?.allowed_addresses, ["203.0.113.2", "203.0.113.3"]);

  const fakeTrunk = provisioner.trunks.get(created.number.livekit_trunk_id!);
  assert.deepEqual(fakeTrunk?.allowedAddresses, ["203.0.113.2", "203.0.113.3"]);

  // Attempting to clear all IPs on an IP-only trunk fails
  await assert.rejects(
    () => service.updateByoAccess(WS_A, created.number.id, []),
    (err: unknown) => err instanceof AppError && err.code === "VALIDATION_FAILED",
  );
});

test("release removes BYO SIP number and deprovisions LiveKit trunk", async () => {
  const { service, provisioner, repo } = makeService();
  const created = await service.registerByo(WS_A, {
    e164: "+14155550444",
    allowed_addresses: ["203.0.113.5"],
  });

  assert.ok(provisioner.trunks.has(created.number.livekit_trunk_id!));
  const released = await service.release(WS_A, created.number.id, "provider");
  assert.equal(released.status, "released");
  assert.equal(provisioner.trunks.has(created.number.livekit_trunk_id!), false);
  assert.equal(await repo.getById(created.number.id), null);
});

test("DisabledTelnyxClient refuses purchases with clear error", async () => {
  const { service } = makeService({ disabledTelnyx: true });

  await assert.rejects(
    () => service.purchase(WS_A, { e164: "+14155550333" }),
    (err: unknown) =>
      err instanceof AppError &&
      err.message.includes("Buying numbers is not enabled on this deployment"),
  );
});

test("detectSipMode identifies cloud vs self-hosted vs unconfigured", () => {
  assert.equal(detectSipMode("my-project.sip.livekit.cloud", true), "livekit_cloud");
  assert.equal(detectSipMode("sip.mycompany.com:5060", true), "self_hosted");
  assert.equal(detectSipMode("198.51.100.10", true), "self_hosted");
  assert.equal(detectSipMode("my-project.sip.livekit.cloud", false), "not_configured");
  assert.equal(detectSipMode(undefined, false), "not_configured");
});

test("normalizeAllowedAddresses validates IP and CIDR prefixes", () => {
  const valid = normalizeAllowedAddresses(["203.0.113.10", "198.51.100.0/24", "2001:db8::/48"]);
  assert.deepEqual(valid, ["203.0.113.10", "198.51.100.0/24", "2001:db8::/48"]);

  // Hostnames rejected
  assert.throws(() => normalizeAllowedAddresses(["sip.example.com"]), /Hostnames are not supported/);
  // Too broad IPv4 prefix rejected
  assert.throws(() => normalizeAllowedAddresses(["10.0.0.0/8"]), /too broad/);
  // Invalid IP rejected
  assert.throws(() => normalizeAllowedAddresses(["999.999.999.999"]), /not a valid IP/);
});

test("validateAuthUsername enforces valid characters and length", () => {
  assert.equal(validateAuthUsername("trunk_user_1"), "trunk_user_1");
  assert.throws(() => validateAuthUsername("a"), /3-64 characters/);
  assert.throws(() => validateAuthUsername("invalid username with space!"), /letters, digits/);
});

test("telephony factory supports profile=sip", () => {
  assert.equal(resolveTelephonyProfile("sip", false, false, true), "sip");
  // Auto-select sip if LiveKit is configured and no Telnyx/Twilio creds
  assert.equal(resolveTelephonyProfile(undefined, false, false, true), "sip");

  // assertTelephonyBootAllowed fails closed if real required and LiveKit not configured
  assert.throws(
    () =>
      assertTelephonyBootAllowed({
        profile: "sip",
        livekitConfigured: false,
        requireRealTelephony: true,
      }),
    /TELEPHONY_REQUIRE_REAL=1 with TELEPHONY_PROFILE=sip requires LIVEKIT_URL/,
  );

  const { router, telnyxClient } = createTelephonyRouter({
    profile: "sip",
    publicBaseUrl: "https://voice.example.com",
    sipBridgeSharedSecret: "secret",
    requireRealTelephony: false,
  });

  assert.equal(telnyxClient instanceof DisabledTelnyxClient, true);
  assert.ok(router.list().some((p) => p.id === "sip"));
});

test("buildInboundSetup evaluates readiness checks", async () => {
  const provisioner = new FakeSipProvisioner();
  const edge = buildSipEdge({
    sipEndpoint: "sip.example.com",
    port: 5060,
    tlsPort: 5061,
  });

  const setup = await buildInboundSetup({
    mode: "self_hosted",
    provisioner,
    edge,
    publicBaseUrl: "https://voice.example.com",
    bridgeEnabled: true,
    bridgeActive: true,
    speechPipelineReady: true,
    purchaseAvailable: false,
  });

  assert.equal(setup.mode, "self_hosted");
  assert.equal(setup.byo_sip_available, true);
  assert.equal(setup.purchase_available, false);
  assert.equal(setup.webhooks.livekit, "https://voice.example.com/voice/telephony/livekit/webhook");
  assert.ok(setup.checks.some((c) => c.id === "livekit_configured" && c.status === "error")); // Fake provisioner is not configured
});

test("SIP probe builds valid OPTIONS request and parses response", () => {
  const req = buildOptionsRequest({
    host: "sip.example.com",
    port: 5060,
    transport: "udp",
    localHost: "192.0.2.1",
    callId: "test-call-id-123",
  });

  assert.ok(req.startsWith("OPTIONS sip:sip.example.com:5060 SIP/2.0\r\n"));
  assert.ok(req.includes("Call-ID: test-call-id-123\r\n"));
  assert.ok(req.includes("CSeq: 1 OPTIONS\r\n"));

  const parsed = parseSipResponse(
    "SIP/2.0 200 OK\r\nVia: SIP/2.0/UDP 192.0.2.1:5060\r\nServer: LiveKit-SIP/1.0\r\nAllow: INVITE, ACK, CANCEL, OPTIONS, BYE\r\nContent-Length: 0\r\n\r\n",
  );
  assert.ok(parsed);
  assert.equal(parsed.reachable, true);
  assert.equal(parsed.statusCode, 200);
  assert.equal(parsed.statusText, "OK");
  assert.equal(parsed.server, "LiveKit-SIP/1.0");
  assert.equal(parsed.allow, "INVITE, ACK, CANCEL, OPTIONS, BYE");
});
