/**
 * Turn-taking policy for the live voice session.
 *
 * These helpers are pure so latency/interruption behavior can be tested without
 * opening WebSockets, Deepgram, or LiveKit.
 */

/** Frames at or above this energy count as caller speech. */
export const SPEECH_ENERGY_THRESHOLD = 0.12;

/** Minimum absolute energy for an interruption, above the rolling noise floor. */
export const BARGE_IN_BASE_ENERGY = 0.22;

/** Consecutive speech frames required before we accept an interruption. */
export const BARGE_IN_FRAMES = 3;

/** Do not commit a turn until the caller has been quiet this long. */
export const SPEECH_TAIL_SILENCE_MS = 180;

/** Frames kept while Deepgram is still connecting (20 ms frames → 500 ms). */
export const PRE_READY_FRAME_LIMIT = 25;

/** Keep the first phrase fast, then give TTS enough context for natural prosody. */
export function firstSpeakableCut(pending: string, firstChunk = true): number {
  // A punctuation mark inside a number is not a speech boundary; punctuation
  // after a number ("Order 42.") is. Include Unicode digits used in Urdu.
  for (const match of pending.matchAll(/[.!?,;:،۔؟]/gu)) {
    const index = match.index;
    const before = pending[index - 1] ?? "";
    const after = pending[index + 1] ?? "";
    if (/\p{N}/u.test(before) && /\p{N}/u.test(after)) continue;
    if (/[.,]/.test(match[0]) && /\p{N}/u.test(before) && !after) continue;
    // Periods followed immediately by a letter can belong to an abbreviation,
    // URL or identifier. Let a later whitespace/sentence boundary finish it.
    if (match[0] === "." && /\p{L}/u.test(after)) continue;
    if (index >= 2) return index + 1;
  }
  const words = pending.trim().split(/\s+/);
  if (words.length >= (firstChunk ? 3 : 12) && /\s$/u.test(pending)) return pending.length;
  return 0;
}

const FILLER_ONLY = /^(?:(?:um+|uh+|hmm+|mm+|ah+|er+|erm+|like|you know|i mean)\s*)+$/iu;

/** True when the finalized transcript is only a hesitation, not a request. */
export function isFillerOnly(text: string): boolean {
  const normalized = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s'-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return true;
  return FILLER_ONLY.test(normalized);
}

/**
 * Extra delay needed before committing so we never cut the caller off while
 * they are still producing speech, even if Deepgram endpointing fires early.
 */
export function speechTailDelayMs(
  lastVoiceAt: number,
  now: number,
  silenceMs = SPEECH_TAIL_SILENCE_MS,
): number {
  if (!lastVoiceAt) return 0;
  return Math.max(0, silenceMs - (now - lastVoiceAt));
}

/** Adaptive interruption threshold: noise floor × 3, clamped to a sane range. */
export function bargeInThreshold(noiseFloor: number): number {
  return Math.min(0.6, Math.max(BARGE_IN_BASE_ENERGY, noiseFloor * 3));
}

/** Slow-moving floor estimate; only feed it frames that are not speech. */
export class NoiseFloorTracker {
  private floor = 0.02;

  update(level: number): void {
    const clamped = Math.min(1, Math.max(0, level));
    this.floor = this.floor * 0.995 + clamped * 0.005;
  }

  get value(): number {
    return this.floor;
  }
}

export class BargeInDetector {
  private frames = 0;

  /** Returns true once when an interruption is accepted. */
  push(level: number, noiseFloor: number): boolean {
    if (level >= bargeInThreshold(noiseFloor)) {
      this.frames += 1;
      if (this.frames >= BARGE_IN_FRAMES) {
        this.frames = 0;
        return true;
      }
      return false;
    }
    this.frames = 0;
    return false;
  }

  reset(): void {
    this.frames = 0;
  }
}
