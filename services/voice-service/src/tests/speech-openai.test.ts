import assert from "node:assert/strict";
import test from "node:test";
import { AppError, ErrorCode } from "@quickstart/errors";
import { assertSpeechBootAllowed, createSpeechBundle } from "../speech/factory.js";
import { OpenAiSpeechToText } from "../speech/openai-stt.js";
import { OpenAiTextToSpeech } from "../speech/openai-tts.js";
import { withSpeechPolicy } from "../speech/policy.js";
import type { AudioChunk } from "../speech/types.js";

const SAMPLE: AudioChunk = {
  bytes: Buffer.from("hello fixture", "utf8"),
  encoding: "fake",
  sampleRateHz: 8000,
};

test("assertSpeechBootAllowed fails closed when real speech required", () => {
  assert.throws(
    () => assertSpeechBootAllowed({ profile: "fake", requireRealSpeech: true }),
    /VOICE_REQUIRE_REAL_SPEECH/,
  );
  assert.throws(
    () =>
      assertSpeechBootAllowed({
        profile: "openai",
        requireRealSpeech: true,
        openaiApiKey: undefined,
      }),
    /OPENAI_API_KEY/,
  );
  assert.doesNotThrow(() =>
    assertSpeechBootAllowed({
      profile: "openai",
      requireRealSpeech: true,
      openaiApiKey: "sk-test-key-not-for-production",
    }),
  );
});

test("OpenAI STT uses fixture fetch and the current transcription model", async () => {
  const seenAuth: string[] = [];
  let seenModel = "";
  const fetchImpl: typeof fetch = async (_url, init) => {
    const headers = init?.headers as Record<string, string> | undefined;
    if (headers?.Authorization) seenAuth.push(headers.Authorization);
    if (init?.body instanceof FormData) {
      seenModel = String(init.body.get("model") ?? "");
    }
    return new Response(JSON.stringify({ text: "fixture transcript" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };
  const stt = new OpenAiSpeechToText({
    apiKey: "sk-secret-should-not-leak",
    fetchImpl,
  });
  const result = await stt.transcribe(SAMPLE);
  assert.equal(result.text, "fixture transcript");
  assert.equal(result.provider, "openai-stt");
  assert.equal(seenAuth[0], "Bearer sk-secret-should-not-leak");
  assert.equal(seenModel, "gpt-transcribe");
});

test("OpenAI TTS fixture path returns mp3 bytes with the current TTS model", async () => {
  let seenModel = "";
  const fetchImpl: typeof fetch = async (_url, init) => {
    const body = JSON.parse(String(init?.body ?? "{}")) as { model?: string };
    seenModel = body.model ?? "";
    return new Response(Buffer.from("ID3fixture-mp3"), {
      status: 200,
      headers: { "content-type": "audio/mpeg" },
    });
  };
  const tts = new OpenAiTextToSpeech({
    apiKey: "sk-secret-should-not-leak",
    fetchImpl,
  });
  const result = await tts.synthesize("hello", "alloy");
  assert.equal(result.provider, "openai-tts");
  assert.equal(result.audio.encoding, "mp3");
  assert.ok(result.audio.bytes.length > 0);
  assert.equal(seenModel, "gpt-4o-mini-tts-2025-12-15");
});

test("OpenAI TTS streaming emits audio before the full clip is ready", async () => {
  const chunks: Buffer[] = [];
  const fetchImpl: typeof fetch = async () =>
    new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3]));
          controller.enqueue(new Uint8Array([4, 5, 6]));
          controller.close();
        },
      }),
      { status: 200, headers: { "content-type": "audio/mpeg" } },
    );
  const tts = new OpenAiTextToSpeech({ apiKey: "sk-test", fetchImpl });
  const metrics = await tts.streamSynthesize("hello", "alloy", (audio) => chunks.push(audio.bytes));
  assert.equal(chunks.length, 2);
  assert.deepEqual([...chunks[0]], [1, 2]);
  assert.deepEqual([...chunks[1]], [3, 4, 5, 6]);
  assert.ok(metrics.firstChunkLatencyMs > 0);
});

test("policy retries once on upstream failure before billable output", async () => {
  let attempts = 0;
  const flakyStt = {
    id: "flaky-stt",
    async transcribe() {
      attempts += 1;
      if (attempts === 1) {
        throw new AppError({
          code: ErrorCode.UPSTREAM_UNAVAILABLE,
          message: "transient",
        });
      }
      return { text: "ok", latencyMs: 1, provider: "flaky-stt" };
    },
  };
  const tts = {
    id: "noop-tts",
    async synthesize() {
      return {
        audio: { bytes: Buffer.from("x"), encoding: "fake" as const, sampleRateHz: 8000 },
        latencyMs: 1,
        provider: "noop-tts",
      };
    },
  };
  const usage: unknown[] = [];
  const { stt } = withSpeechPolicy(flakyStt, tts, {
    failureThreshold: 10,
    emitUsage: (f) => usage.push(f),
  });
  const result = await stt.transcribe(SAMPLE);
  assert.equal(result.text, "ok");
  assert.equal(attempts, 2);
  assert.equal((usage[0] as { unit: string }).unit, "stt");
});

test("createSpeechBundle openai profile wires policy adapters", async () => {
  const fetchImpl: typeof fetch = async (url) => {
    const href = String(url);
    if (href.includes("/audio/transcriptions")) {
      return new Response(JSON.stringify({ text: "bundle hello" }), { status: 200 });
    }
    return new Response(Buffer.from("mp3"), { status: 200 });
  };
  const bundle = createSpeechBundle({
    profile: "openai",
    openaiApiKey: "sk-test",
    requireRealSpeech: false,
    circuitFailureThreshold: 5,
    circuitCooldownMs: 30_000,
    httpTimeoutMs: 5_000,
    fetchImpl,
  });
  const stt = await bundle.stt.transcribe(SAMPLE);
  assert.equal(stt.text, "bundle hello");
  assert.equal(stt.provider, "openai-stt");
  const tts = await bundle.tts.synthesize("hi", "alloy");
  assert.equal(tts.provider, "openai-tts");
});

test("usage emitter payloads never include api key material", async () => {
  const facts: Array<Record<string, unknown>> = [];
  const fetchImpl: typeof fetch = async () =>
    new Response(JSON.stringify({ text: "safe" }), { status: 200 });
  const bundle = createSpeechBundle({
    profile: "openai",
    openaiApiKey: "sk-super-secret-key-value",
    requireRealSpeech: true,
    circuitFailureThreshold: 5,
    circuitCooldownMs: 30_000,
    httpTimeoutMs: 5_000,
    fetchImpl,
    emitUsage: (f) => facts.push(f as unknown as Record<string, unknown>),
  });
  await bundle.stt.transcribe(SAMPLE);
  const serialized = JSON.stringify(facts);
  assert.equal(serialized.includes("sk-super-secret"), false);
  assert.equal(facts[0]?.type, "speech.usage");
});

test("live OpenAI speech requests PCM and natural delivery while preserving caller voice", async () => {
  let body: Record<string, unknown> = {};
  const tts = new OpenAiTextToSpeech({
    apiKey: "test",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(new Uint8Array([0, 1, 2, 3]));
    },
  });
  await tts.streamSynthesize("Hello.", "cedar", (audio) => {
    assert.equal(audio.encoding, "pcm16");
    assert.equal(audio.sampleRateHz, 24000);
  });
  assert.equal(body.response_format, "pcm");
  assert.equal(body.voice, "cedar");
  assert.match(String(body.instructions), /naturally/);
});

test("legacy TTS omits unsupported default style instructions and rejects truncated PCM", async () => {
  let body: Record<string, unknown> = {};
  const tts = new OpenAiTextToSpeech({
    apiKey: "test",
    model: "tts-1",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return new Response(new Uint8Array([0, 1, 2]));
    },
  });
  await assert.rejects(
    tts.streamSynthesize("Hello.", "alloy", () => {}),
    /incomplete PCM/,
  );
  assert.equal(body.instructions, undefined);
});
