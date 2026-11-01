import assert from "node:assert/strict";
import test from "node:test";
import { CartesiaTextToSpeech } from "../speech/cartesia-tts.js";
import { CatalogTextToSpeech } from "../speech/catalog-tts.js";

function providerStream() {
  return new Response(
    `event: chunk\r\ndata: ${JSON.stringify({ type: "chunk", data: Buffer.from([0, 1, 2, 3]).toString("base64") })}\r\n\r\nevent: done\r\ndata: {"type":"done"}\r\n\r\n`,
  );
}

test("streamed Urdu catalog voice keeps its language and emits correctly described PCM", async () => {
  let body: Record<string, unknown> = {};
  const catalog = new CatalogTextToSpeech({
    cartesiaApiKey: "test",
    fetchImpl: async (_url, init) => {
      body = JSON.parse(String(init?.body));
      return providerStream();
    },
  });
  const audio: { encoding: string; sampleRateHz: number; bytes: Buffer }[] = [];
  await catalog.streamSynthesize("سلام", "cartesia:d463004e-0353-4063-80d4-2fabbf1c5dcb", (chunk) =>
    audio.push(chunk),
  );
  assert.equal(body.language, "ur");
  assert.equal(body.voice, "d463004e-0353-4063-80d4-2fabbf1c5dcb");
  assert.equal(audio.length, 1);
  assert.equal(audio[0]!.encoding, "pcm16");
  assert.equal(audio[0]!.sampleRateHz, 22050);
  assert.deepEqual([...audio[0]!.bytes], [0, 1, 2, 3]);
});

test("Cartesia emits audio before completion and cancels a still-open response on done", async () => {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  let cancelled = false;
  const tts = new CartesiaTextToSpeech({
    apiKey: "test",
    fetchImpl: async () =>
      new Response(
        new ReadableStream({
          start(value) {
            controller = value;
          },
          cancel() {
            cancelled = true;
          },
        }),
      ),
  });
  let heard!: () => void;
  const firstAudio = new Promise<void>((resolve) => {
    heard = resolve;
  });
  const synthesis = tts.streamSynthesize("Hello.", "voice", () => heard());
  controller.enqueue(new TextEncoder().encode('data: {"type":"chunk","data":"AAE="}\n\n'));
  await firstAudio;
  controller.enqueue(new TextEncoder().encode('data: {"type":"done"}\n\n'));
  await synthesis;
  assert.equal(cancelled, true);
});
