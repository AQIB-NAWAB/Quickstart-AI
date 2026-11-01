import assert from "node:assert/strict";
import test from "node:test";
import { AppError, ErrorCode } from "@quickstart/errors";
import { withSpeechPolicy } from "../speech/policy.js";
import type { TextToSpeech } from "../speech/types.js";
const audio = { bytes: Buffer.from([0, 1]), encoding: "pcm16" as const, sampleRateHz: 24000 };
const unavailable = () =>
  new AppError({ code: ErrorCode.UPSTREAM_UNAVAILABLE, message: "provider unavailable" });
const stt = {
  id: "test",
  async transcribe() {
    return { text: "hi", latencyMs: 1, provider: "test" };
  },
};

test("speech policy retains streaming and retries only before the first audible chunk", async () => {
  let attempts = 0;
  let usage = 0;
  const provider: TextToSpeech = {
    id: "test",
    async synthesize() {
      throw new Error("must stream");
    },
    async streamSynthesize(_text, _voice, onAudio) {
      if (++attempts === 1) throw unavailable();
      onAudio(audio);
      return { firstChunkLatencyMs: 1, latencyMs: 2 };
    },
  };
  const { tts } = withSpeechPolicy(stt, provider, { emitUsage: () => usage++ });
  let chunks = 0;
  await tts.streamSynthesize!("Hello", "voice", () => chunks++);
  assert.equal(attempts, 2);
  assert.equal(chunks, 1);
  assert.equal(usage, 1);
});

test("partially spoken provider failure never replays speech", async () => {
  let attempts = 0;
  const provider: TextToSpeech = {
    id: "test",
    async synthesize() {
      throw new Error("must stream");
    },
    async streamSynthesize(_text, _voice, onAudio) {
      attempts++;
      onAudio(audio);
      throw unavailable();
    },
  };
  const { tts } = withSpeechPolicy(stt, provider);
  let chunks = 0;
  await assert.rejects(
    tts.streamSynthesize!("Hello", "voice", () => chunks++),
    /provider unavailable/,
  );
  assert.equal(attempts, 1);
  assert.equal(chunks, 1);
});

test("an interrupted stream is never retried", async () => {
  let attempts = 0;
  const abort = new AbortController();
  const provider: TextToSpeech = {
    id: "test",
    async synthesize() {
      throw new Error("must stream");
    },
    async streamSynthesize() {
      attempts++;
      abort.abort();
      throw unavailable();
    },
  };
  const { tts } = withSpeechPolicy(stt, provider);
  await assert.rejects(tts.streamSynthesize!("Hello", "voice", () => {}, abort.signal));
  assert.equal(attempts, 1);
});
