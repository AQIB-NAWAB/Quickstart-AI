import assert from "node:assert/strict";
import test from "node:test";
import { pcm16ToWav } from "../widget-voice/session-manager.js";

test("telephony PCM recordings are finalized as playable mono WAV", () => {
  const pcm = Buffer.from([0, 0, 0xff, 0x7f]);
  const wav = pcm16ToWav(pcm, 16_000);

  assert.equal(wav.subarray(0, 4).toString("ascii"), "RIFF");
  assert.equal(wav.subarray(8, 12).toString("ascii"), "WAVE");
  assert.equal(wav.readUInt16LE(20), 1);
  assert.equal(wav.readUInt16LE(22), 1);
  assert.equal(wav.readUInt32LE(24), 16_000);
  assert.equal(wav.readUInt32LE(40), pcm.length);
  assert.deepEqual(wav.subarray(44), pcm);
});
