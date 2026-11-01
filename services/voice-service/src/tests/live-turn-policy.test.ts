import assert from "node:assert/strict";
import test from "node:test";
import { eagerCommitDelayMs } from "../turn-detection/eager-commit.js";
import {
  BargeInDetector,
  NoiseFloorTracker,
  bargeInThreshold,
  firstSpeakableCut,
  isFillerOnly,
  speechTailDelayMs,
} from "../turn-detection/live-turn-policy.js";

test("filler-only transcripts never commit a turn", () => {
  assert.equal(isFillerOnly("um"), true);
  assert.equal(isFillerOnly("uh, um..."), true);
  assert.equal(isFillerOnly("you know"), true);
  assert.equal(isFillerOnly("I mean"), true);
  assert.equal(isFillerOnly(""), true);
  assert.equal(isFillerOnly("yes"), false);
  assert.equal(isFillerOnly("I need help with my order"), false);
  assert.equal(isFillerOnly("no thanks"), false);
});

test("eager commits still wait for open-ended phrases", () => {
  assert.equal(eagerCommitDelayMs("I need help."), 40);
  assert.equal(eagerCommitDelayMs("I need help and"), 350);
  assert.equal(eagerCommitDelayMs("hi"), 300);
  assert.ok(eagerCommitDelayMs("what is the price") >= 120);
});

test("speech tail delay protects a caller who is still talking", () => {
  assert.equal(speechTailDelayMs(0, 1_000), 0);
  assert.equal(speechTailDelayMs(1_000, 1_100), 80);
  assert.equal(speechTailDelayMs(1_000, 1_300), 0);
});

test("TTS starts at the first comma or short clause", () => {
  assert.equal(firstSpeakableCut("Sure, I can help"), 5);
  assert.equal(firstSpeakableCut("Ok, let me check"), 3);
  assert.equal(firstSpeakableCut("I can help "), 11);
  assert.equal(firstSpeakableCut("I can"), 0);
  assert.equal(firstSpeakableCut("It is 3.5 miles away"), 0);
});

test("barge-in threshold rises above line noise but stays bounded", () => {
  assert.equal(bargeInThreshold(0.02), 0.22);
  assert.ok(Math.abs(bargeInThreshold(0.1) - 0.3) < 1e-9);
  assert.equal(bargeInThreshold(0.5), 0.6);
});

test("barge-in needs three consecutive frames above the adaptive floor", () => {
  const detector = new BargeInDetector();
  assert.equal(detector.push(0.3, 0.02), false);
  assert.equal(detector.push(0.3, 0.02), false);
  assert.equal(detector.push(0.3, 0.02), true);

  // A quiet frame resets the run; isolated clicks do not interrupt.
  assert.equal(detector.push(0.3, 0.02), false);
  assert.equal(detector.push(0.01, 0.02), false);
  assert.equal(detector.push(0.3, 0.02), false);
  assert.equal(detector.push(0.3, 0.02), false);
  assert.equal(detector.push(0.3, 0.02), true);

  // High noise floors require louder speech.
  detector.reset();
  assert.equal(detector.push(0.3, 0.4), false);
  assert.equal(detector.push(0.65, 0.4), false);
  assert.equal(detector.push(0.65, 0.4), false);
  assert.equal(detector.push(0.65, 0.4), true);
});

test("noise floor tracks quiet frames only and stays in range", () => {
  const floor = new NoiseFloorTracker();
  const initial = floor.value;
  for (let index = 0; index < 200; index += 1) floor.update(0.01);
  assert.ok(floor.value < initial);
  assert.ok(floor.value >= 0);
  assert.ok(floor.value <= 1);
});

test("spoken record identifiers and numbers are meaningful caller turns", () => {
  for (const text of ["42", "۰۱۲۳", "123-456", "#100", "جی", "ہاں"]) {
    assert.equal(isFillerOnly(text), false, text);
  }
  assert.equal(isFillerOnly("..."), true);
});

test("later speech chunks preserve phrases instead of splitting every three words", () => {
  assert.equal(firstSpeakableCut("I can help ", false), 0);
  assert.equal(
    firstSpeakableCut("I can help you find your order and check its current status ", false),
    60,
  );
  assert.equal(firstSpeakableCut("Your order is ready. Anything else?", false), 20);
});

test("speech boundaries preserve decimal values and recognize sentences ending in numbers", () => {
  assert.equal(firstSpeakableCut("It costs 19.99 dollars. "), 23);
  assert.equal(firstSpeakableCut("Order 42. What else?"), 9);
  const urdu = "قیمت ۳.۵ روپے ہے۔";
  assert.equal(urdu.slice(0, firstSpeakableCut(urdu)), urdu);
  assert.equal(firstSpeakableCut("Use example.com for details"), 0);
});
