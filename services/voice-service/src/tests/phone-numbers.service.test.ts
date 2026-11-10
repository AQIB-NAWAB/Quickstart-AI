import assert from "node:assert/strict";
import test from "node:test";
import { AppError } from "@quickstart/errors";
import { createLogger } from "@quickstart/logging";
import {
  MemoryPhoneNumbersRepository,
} from "../repository/phone-numbers.repository.js";
import { PhoneNumbersService } from "../services/phone-numbers.service.js";
import { FakeTelnyxClient } from "../telephony/telnyx/fake-client.js";
import {
  FakeSipProvisioner,
  inboundRoomPrefix,
  numberIdFromRoomName,
} from "../telephony/livekit/sip-provisioner.js";

const WS_A = "11111111-1111-4111-8111-111111111111";
const WS_B = "22222222-2222-4222-8222-222222222222";

function makeService() {
  const repo = new MemoryPhoneNumbersRepository();
  const telnyx = new FakeTelnyxClient();
  const provisioner = new FakeSipProvisioner();
  const service = new PhoneNumbersService({
    repo,
    telnyx,
    provisioner,
    connectionName: "Test Inbound",
    logger: createLogger({ service: "phone-numbers-test" }),
    orderPollAttempts: 1,
    orderPollIntervalMs: 0,
  });
  return { repo, telnyx, provisioner, service };
}

test("purchase orders, provisions LiveKit, and resolves inbound routing", async () => {
  const { service, repo } = makeService();

  const number = await service.purchase(WS_A, {
    e164: "+14155550123",
    agent_id: "agent-1",
    friendly_name: "Sales line",
  });

  assert.equal(number.phone_number, "+14155550123");
  assert.equal(number.workspace_id, WS_A);
  assert.equal(number.status, "active");
  assert.equal(number.inbound_status, "active");
  assert.equal(number.assigned_agent_id, "agent-1");
  assert.ok(number.livekit_trunk_id);
  assert.ok(number.livekit_dispatch_rule_id);
  assert.equal(number.provisioning_error, null);

  const route = await service.resolveInbound("+14155550123");
  assert.deepEqual(route, {
    numberId: number.id,
    workspaceId: WS_A,
    agentId: "agent-1",
    e164: "+14155550123",
    roomPrefix: inboundRoomPrefix(number.id),
    provider: "telnyx",
  });

  const stored = await repo.getById(number.id);
  assert.equal(stored?.provider, "telnyx");
  assert.equal(stored?.status, "active");
});

test("purchase claims a platform pool number from Telnyx sync", async () => {
  const { service } = makeService();
  await service.syncOwnedNumbers();

  const pool = await service.listPool();
  assert.equal(pool.length, 3);
  const pooled = pool[0];

  const claimed = await service.purchase(WS_A, {
    e164: pooled.phone_number,
    agent_id: "agent-2",
  });
  assert.equal(claimed.workspace_id, WS_A);
  assert.equal(claimed.assigned_agent_id, "agent-2");
  assert.equal(claimed.status, "active");

  const remainingPool = await service.listPool();
  assert.equal(remainingPool.length, 2);
});

test("assign updates the agent without changing LiveKit routing", async () => {
  const { service } = makeService();
  const number = await service.purchase(WS_A, {
    e164: "+14155550124",
    agent_id: "agent-1",
  });

  const updated = await service.assign(WS_A, number.id, {
    assigned_agent_id: "agent-9",
    friendly_name: "Renamed line",
  });
  assert.equal(updated.assigned_agent_id, "agent-9");
  assert.equal(updated.friendly_name, "Renamed line");
  assert.equal(updated.livekit_trunk_id, number.livekit_trunk_id);

  const route = await service.resolveInbound("+14155550124");
  assert.equal(route?.agentId, "agent-9");
});

test("release to pool clears routing and returns the number to the platform pool", async () => {
  const { service, telnyx } = makeService();
  const number = await service.purchase(WS_A, {
    e164: "+14155550125",
    agent_id: "agent-1",
  });

  const released = await service.release(WS_A, number.id, "pool");
  assert.equal(released.workspace_id, null);
  assert.equal(released.status, "active");
  assert.equal(released.inbound_status, "pending");
  assert.equal(released.livekit_trunk_id, null);
  assert.equal(released.livekit_dispatch_rule_id, null);

  assert.equal(await service.resolveInbound("+14155550125"), null);
  const owned = await telnyx.listOwnedNumbers();
  assert.ok(owned.some((entry) => entry.phoneNumber === "+14155550125"));
});

test("release at provider deletes the Telnyx number", async () => {
  const { service, telnyx } = makeService();
  const number = await service.purchase(WS_A, {
    e164: "+14155550126",
    agent_id: "agent-1",
  });

  const released = await service.release(WS_A, number.id, "provider");
  assert.equal(released.status, "released");
  assert.equal(released.released_at === null, false);

  const owned = await telnyx.listOwnedNumbers();
  assert.equal(
    owned.some((entry) => entry.phoneNumber === "+14155550126"),
    false,
  );
});

test("purchase rejects a number owned by another workspace", async () => {
  const { service } = makeService();
  await service.purchase(WS_A, { e164: "+14155550127", agent_id: "agent-1" });

  await assert.rejects(
    () => service.purchase(WS_B, { e164: "+14155550127" }),
    (err: unknown) => err instanceof AppError && err.code === "CONFLICT",
  );
});

test("number order webhook marks a provisioning row active", async () => {
  const { service, repo } = makeService();
  await repo.create({
    workspaceId: WS_A,
    phoneNumber: "+14155550128",
    provider: "telnyx",
    status: "provisioning",
    inboundStatus: "provisioning",
  });

  const result = await service.handleTelnyxEvent({
    data: {
      event_type: "number_order.completed",
      payload: {
        phone_numbers: [{ phone_number: "+14155550128" }],
      },
    },
  });
  assert.equal(result.handled, true);
  const row = await repo.getByE164("+14155550128");
  assert.equal(row?.status, "active");
  assert.equal(row?.inbound_status, "active");
});

test("room names resolve to the phone number id", () => {
  const numberId = "33333333-3333-4333-8333-333333333333";
  const room = `${inboundRoomPrefix(numberId)}abc123`;
  assert.equal(numberIdFromRoomName(room), numberId);
  assert.equal(numberIdFromRoomName("other-room"), null);
});
