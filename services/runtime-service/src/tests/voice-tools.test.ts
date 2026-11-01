import assert from "node:assert/strict";
import test from "node:test";
import {
  spokenToolNudge,
  toolChangesData,
  utteranceRequestsAction,
  visitorConfirmed,
  visitorWantsTeammate,
  VOICE_TRANSFER_TOOL,
  VOICE_TRANSFER_TOOL_NAME,
} from "../services/voice-tools.js";
import type { AgentToolDefinition } from "@quickstart/contracts";

test("a normal voice question does not open tools", () => {
  assert.equal(utteranceRequestsAction("what is the price"), false);
  assert.equal(utteranceRequestsAction("tell me about the product"), false);
  assert.equal(utteranceRequestsAction("please look up order 14"), true);
  assert.equal(utteranceRequestsAction("would this work for our team"), true);
  assert.equal(utteranceRequestsAction("can I book Friday"), true);
  assert.equal(utteranceRequestsAction("do you have anything open Thursday"), true);
  assert.equal(utteranceRequestsAction("can you call me tomorrow"), true);
});

test("only an explicit request for a person is a transfer", () => {
  assert.equal(visitorWantsTeammate("can I talk to a human"), true);
  assert.equal(visitorWantsTeammate("مجھے ساتھی سے بات کرنی ہے"), true);
  assert.equal(visitorWantsTeammate("what is the price"), false);
  assert.equal(visitorWantsTeammate("tell me about personal plans"), false);
  assert.equal(visitorWantsTeammate("someone told me about this"), false);
});

test("writes wait for a yes and lookups do not", () => {
  const write: AgentToolDefinition = {
    id: "http:create",
    name: "create_post",
    description: "Create a post",
    type: "http",
    method: "POST",
    base_url: "https://example.com",
    allowed_hosts: ["example.com"],
  };
  assert.equal(toolChangesData(write), true);
  assert.equal(toolChangesData(VOICE_TRANSFER_TOOL), false);
  assert.equal(visitorConfirmed("yes, go ahead"), true);
  assert.equal(visitorConfirmed("what is pricing"), false);
});

test("tool nudges are short spoken lines", () => {
  assert.match(spokenToolNudge(VOICE_TRANSFER_TOOL_NAME, "en"), /switching you/i);
  assert.match(spokenToolNudge("lookup_order", "en"), /fetching/i);
  assert.match(spokenToolNudge("order_status", "en"), /checking/i);
});

test("a negated or corrected yes never authorizes a voice action", () => {
  for (const text of [
    "Yes, but do not book anything yet.",
    "Yes, don't cancel it.",
    "No, wait.",
    "Okay, not yet.",
    "ہاں، ابھی نہیں",
    "haan, abhi nahi",
  ]) {
    assert.equal(visitorConfirmed(text), false, text);
  }
  assert.equal(visitorConfirmed("Yes, go ahead."), true);
});
