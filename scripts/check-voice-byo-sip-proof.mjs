#!/usr/bin/env node
/**
 * Bring-your-own SIP (BYO SIP) proof (no external credentials required).
 *
 * Covers:
 *   1. Registering a customer-managed SIP number with source IPs & credentials
 *   2. Verifying one-time password returned on registration
 *   3. Verifying repository metadata never stores the password
 *   4. Resolving inbound routing to LiveKit room prefix with provider=byo_sip
 *   5. Reading connection details (password omitted)
 *   6. Rotating credentials and verifying trunk update
 *   7. Updating source IP allowlist
 *   8. Refusing open trunks (validation error)
 *   9. Removing the BYO number and deprovisioning trunk
 *  10. Inbound setup readiness reporting
 *
 * Usage:
 *   pnpm --filter @quickstart/service-voice build
 *   node scripts/check-voice-byo-sip-proof.mjs
 */
import assert from "node:assert/strict";
import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import console from "node:console";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dist = path.join(root, "services/voice-service/dist");

const logger = {
  debug() {},
  info() {},
  warn() {},
  error() {},
  child() {
    return logger;
  },
};

async function load(relative) {
  return import(pathToFileURL(path.join(dist, relative)).href);
}

async function main() {
  const { MemoryPhoneNumbersRepository } = await load("repository/phone-numbers.repository.js");
  const { PhoneNumbersService } = await load("services/phone-numbers.service.js");
  const { FakeTelnyxClient } = await load("telephony/telnyx/fake-client.js");
  const { FakeSipProvisioner, inboundRoomPrefix } = await load("telephony/livekit/sip-provisioner.js");
  const { buildSipEdge, detectSipMode } = await load("telephony/sip-edge.js");
  const { buildInboundSetup } = await load("services/inbound-setup.service.js");

  const WS = "11111111-1111-4111-8111-111111111111";
  const repo = new MemoryPhoneNumbersRepository();
  const telnyx = new FakeTelnyxClient();
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
    connectionName: "Proof Inbound",
    sipEdge,
    logger,
    orderPollAttempts: 1,
    orderPollIntervalMs: 0,
  });

  const report = {
    steps: [],
  };

  // 1. Register BYO SIP number
  const registered = await service.registerByo(WS, {
    e164: "+14155550199",
    agent_id: "agent-sales",
    friendly_name: "PBX Inbound Line",
    allowed_addresses: ["203.0.113.50", "198.51.100.0/24"],
    generate_credentials: true,
  });

  assert.equal(registered.number.phone_number, "+14155550199");
  assert.equal(registered.number.provider, "byo_sip");
  assert.equal(registered.number.status, "active");
  assert.ok(registered.number.livekit_trunk_id);
  assert.ok(registered.connection.auth_password);
  assert.ok(registered.connection.auth_username);
  report.steps.push({
    step: "register_byo_sip",
    number_id: registered.number.id,
    trunk_id: registered.number.livekit_trunk_id,
    auth_username: registered.connection.auth_username,
  });

  // 2. Check metadata in repository never holds the password
  const stored = await repo.getById(registered.number.id);
  const byoMeta = stored?.metadata?.byo_sip;
  assert.equal(byoMeta?.auth_password, undefined);
  assert.equal(byoMeta?.auth_username, registered.connection.auth_username);
  report.steps.push({ step: "verify_repo_metadata_safe", password_leaked: false });

  // 3. Resolve inbound routing
  const route = await service.resolveInbound("+14155550199");
  assert.deepEqual(route, {
    numberId: registered.number.id,
    workspaceId: WS,
    agentId: "agent-sales",
    e164: "+14155550199",
    roomPrefix: inboundRoomPrefix(registered.number.id),
    provider: "byo_sip",
  });
  report.steps.push({ step: "resolve_inbound_route", route });

  // 4. Read connection info (password must be undefined)
  const connection = await service.getSipConnection(WS, registered.number.id);
  assert.equal(connection.auth_password, undefined);
  assert.equal(connection.host, "sip.example.com");
  assert.equal(connection.port, 5060);
  assert.deepEqual(connection.allowed_addresses, ["203.0.113.50", "198.51.100.0/24"]);
  report.steps.push({ step: "get_sip_connection", host: connection.host, port: connection.port });

  // 5. Rotate credentials
  const rotated = await service.rotateByoCredentials(WS, registered.number.id);
  assert.ok(rotated.connection.auth_password);
  assert.notEqual(rotated.connection.auth_password, registered.connection.auth_password);
  const fakeTrunk = provisioner.trunks.get(registered.number.livekit_trunk_id);
  assert.equal(fakeTrunk?.authPassword, rotated.connection.auth_password);
  report.steps.push({ step: "rotate_credentials", trunk_password_updated: true });

  // 6. Update allowed source IPs
  const updated = await service.updateByoAccess(WS, registered.number.id, ["203.0.113.88"]);
  assert.deepEqual(updated.sip?.allowed_addresses, ["203.0.113.88"]);
  assert.deepEqual(fakeTrunk?.allowedAddresses, ["203.0.113.88"]);
  report.steps.push({ step: "update_allowed_ips", allowed_addresses: updated.sip?.allowed_addresses });

  // 7. Verify open trunk is rejected
  let openRejected = false;
  try {
    await service.registerByo(WS, {
      e164: "+14155550188",
      allowed_addresses: [],
      generate_credentials: false,
    });
  } catch (err) {
    openRejected = err.code === "VALIDATION_FAILED";
  }
  assert.equal(openRejected, true);
  report.steps.push({ step: "reject_open_trunk", open_rejected: true });

  // 8. Remove the BYO number
  const removed = await service.release(WS, registered.number.id, "provider");
  assert.equal(removed.status, "released");
  assert.equal(provisioner.trunks.has(registered.number.livekit_trunk_id), false);
  assert.equal(await repo.getById(registered.number.id), null);
  report.steps.push({ step: "remove_byo_number", deprovisioned: true });

  // 9. Inbound setup readiness
  const setupInfo = await buildInboundSetup({
    mode: detectSipMode(sipEdge.host, true),
    provisioner,
    edge: sipEdge,
    publicBaseUrl: "https://voice.example.com",
    bridgeEnabled: true,
    bridgeActive: true,
    speechPipelineReady: true,
    purchaseAvailable: true,
  });
  assert.equal(setupInfo.byo_sip_available, true);
  assert.ok(setupInfo.checks.length > 0);
  report.steps.push({ step: "inbound_setup_info", mode: setupInfo.mode, checks_count: setupInfo.checks.length });

  console.log(JSON.stringify({ status: "ok", report }, null, 2));
}

main().catch((err) => {
  console.error("Proof failed:", err);
  process.exit(1);
});
