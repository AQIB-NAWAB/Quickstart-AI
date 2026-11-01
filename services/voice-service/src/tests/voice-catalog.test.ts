import assert from "node:assert/strict";
import test from "node:test";
import { VOICE_CATALOG } from "@quickstart/contracts";
import { CatalogTextToSpeech } from "../speech/catalog-tts.js";
import { eagerCommitDelayMs, frameEnergy } from "../turn-detection/eager-commit.js";

test("catalog includes the best current providers", () => {
  assert.equal(VOICE_CATALOG.length, 7);
  assert.deepEqual(
    [...new Set(VOICE_CATALOG.map((voice) => voice.provider))].sort(),
    ["cartesia", "elevenlabs", "fish", "uplift"],
  );
});

test("catalog routes a preview to the matching provider", async () => {
  const seen: string[] = [];
  const fetchImpl: typeof fetch = async (input) => {
    seen.push(String(input));
    return new Response(Buffer.from("mp3"), { status: 200 });
  };
  const catalog = new CatalogTextToSpeech({
    upliftApiKey: "uplift-test",
    cartesiaApiKey: "cartesia-test",
    fishApiKey: "fish-test",
    fishReferenceId: "fish-voice-1",
    elevenLabsApiKey: "elevenlabs-test",
    elevenLabsVoiceId: "el-voice-1",
    fetchImpl,
  });
  const uplift = await catalog.synthesize("سلام", "uplift:v_8eelc901");
  const cartesia = await catalog.synthesize("Hello", "cartesia:6c756032-11c3-4be8-a120-74f9673fb700");
  const elevenLabs = await catalog.synthesize("Hello", "elevenlabs:reference");
  assert.equal(uplift.provider, "uplift-tts");
  assert.equal(cartesia.provider, "cartesia-tts");
  assert.equal(elevenLabs.provider, "elevenlabs-tts");
  assert.ok(seen.some((url) => url.includes("upliftai.org")));
  assert.ok(seen.some((url) => url.includes("cartesia.ai")));
  assert.ok(seen.some((url) => url.includes("api.elevenlabs.io")));
});

test("unavailable configured voice falls back to an available English voice", async () => {
  const catalog = new CatalogTextToSpeech({
    fishApiKey: "fish-test",
    fishReferenceId: "fish-voice-1",
    fetchImpl: async () => new Response(Buffer.from("mp3"), { status: 200 }),
  });
  const result = await catalog.synthesize(
    "Hello",
    "cartesia:6c756032-11c3-4be8-a120-74f9673fb700",
  );
  assert.equal(result.provider, "fish-tts");
});

test("eager end of turn waits when the phrase is still open", () => {
  assert.ok(eagerCommitDelayMs("I want the blue one and") > eagerCommitDelayMs("I want the blue one."));
  assert.ok(eagerCommitDelayMs("Book it.") < 150);
  const quiet = Buffer.alloc(8);
  const loud = Buffer.alloc(8);
  loud.writeInt16LE(12000, 0);
  loud.writeInt16LE(12000, 2);
  loud.writeInt16LE(12000, 4);
  loud.writeInt16LE(12000, 6);
  assert.ok(frameEnergy(quiet) < frameEnergy(loud));
});
