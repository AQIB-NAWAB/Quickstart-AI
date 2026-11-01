import {
  findVoiceCatalogEntry,
  VOICE_CATALOG,
  type TtsProviderId,
  type VoiceCatalogEntry,
} from "@quickstart/contracts";
import { AppError, ErrorCode } from "@quickstart/errors";
import { CartesiaTextToSpeech } from "./cartesia-tts.js";
import { ElevenLabsTextToSpeech } from "./elevenlabs-tts.js";
import { FishAudioTextToSpeech } from "./fish-tts.js";
import type { AudioChunk, SynthesisResult, SynthesisStreamMetrics, TextToSpeech } from "./types.js";
import { UpliftTextToSpeech } from "./uplift-tts.js";

export type CatalogTtsOptions = {
  upliftApiKey?: string;
  cartesiaApiKey?: string;
  cartesiaModel?: string;
  fishApiKey?: string;
  fishModel?: string;
  fishReferenceId?: string;
  elevenLabsApiKey?: string;
  elevenLabsModel?: string;
  elevenLabsVoiceId?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
};

export class CatalogTextToSpeech implements TextToSpeech {
  readonly id = "catalog-tts";
  readonly availability: Record<TtsProviderId, boolean>;
  private readonly uplift?: UpliftTextToSpeech;
  private readonly cartesia?: CartesiaTextToSpeech;
  private readonly fish?: FishAudioTextToSpeech;
  private readonly elevenLabs?: ElevenLabsTextToSpeech;

  constructor(private readonly options: CatalogTtsOptions) {
    this.uplift = options.upliftApiKey
      ? new UpliftTextToSpeech({
          apiKey: options.upliftApiKey,
          timeoutMs: options.timeoutMs,
          fetchImpl: options.fetchImpl,
        })
      : undefined;
    this.cartesia = options.cartesiaApiKey
      ? new CartesiaTextToSpeech({
          apiKey: options.cartesiaApiKey,
          model: options.cartesiaModel,
          timeoutMs: options.timeoutMs,
          fetchImpl: options.fetchImpl,
        })
      : undefined;
    this.fish = options.fishApiKey
      ? new FishAudioTextToSpeech({
          apiKey: options.fishApiKey,
          model: options.fishModel ?? "s2-pro",
          referenceId: options.fishReferenceId,
          timeoutMs: options.timeoutMs,
          fetchImpl: options.fetchImpl,
        })
      : undefined;
    this.elevenLabs = options.elevenLabsApiKey
      ? new ElevenLabsTextToSpeech({
          apiKey: options.elevenLabsApiKey,
          model: options.elevenLabsModel,
          voiceId: options.elevenLabsVoiceId,
          timeoutMs: options.timeoutMs,
          fetchImpl: options.fetchImpl,
        })
      : undefined;
    this.availability = {
      uplift: Boolean(this.uplift),
      cartesia: Boolean(this.cartesia),
      fish: Boolean(this.fish && options.fishReferenceId),
      elevenlabs: Boolean(this.elevenLabs && options.elevenLabsVoiceId),
    };
  }

  listVoices() {
    return VOICE_CATALOG.map((entry) => ({
      ...entry,
      available: this.availability[entry.provider],
    }));
  }

  private nativeVoiceId(entry: VoiceCatalogEntry): string {
    if (entry.voice_id !== "reference") return entry.voice_id;
    if (entry.provider === "fish") return this.options.fishReferenceId?.trim() ?? "";
    if (entry.provider === "elevenlabs") return this.options.elevenLabsVoiceId?.trim() ?? "";
    return entry.voice_id;
  }

  private implementation(provider: TtsProviderId): TextToSpeech | undefined {
    switch (provider) {
      case "uplift":
        return this.uplift;
      case "cartesia":
        return this.cartesia;
      case "fish":
        return this.fish;
      case "elevenlabs":
        return this.elevenLabs;
      default:
        return undefined;
    }
  }

  private selectEntry(voiceId: string): VoiceCatalogEntry {
    const requested = findVoiceCatalogEntry(voiceId);
    const availableVoices = this.listVoices();
    const requestedAvailable = requested && this.availability[requested.provider];
    return (
      (requestedAvailable ? requested : undefined) ??
      availableVoices.find(
        (voice) => voice.available && voice.language.toLowerCase().startsWith("en"),
      ) ??
      availableVoices.find((voice) => voice.available) ??
      VOICE_CATALOG[0]
    );
  }

  async synthesize(text: string, voiceId: string, signal?: AbortSignal): Promise<SynthesisResult> {
    const entry = this.selectEntry(voiceId);
    const nativeId = this.nativeVoiceId(entry);
    const impl = this.implementation(entry.provider);
    if (!impl || !nativeId) {
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: `${entry.provider} is not configured. Add the API key (and reference id) before previewing ${entry.label}.`,
      });
    }
    if (entry.provider === "cartesia" && this.cartesia) {
      return this.cartesia.synthesize(text, nativeId, signal, entry.language);
    }
    return impl.synthesize(text, nativeId, signal);
  }

  async streamSynthesize(
    text: string,
    voiceId: string,
    onAudio: (audio: AudioChunk) => void,
    signal?: AbortSignal,
  ): Promise<SynthesisStreamMetrics> {
    const entry = this.selectEntry(voiceId);
    const nativeId = this.nativeVoiceId(entry);
    const impl = this.implementation(entry.provider);
    if (!impl || !nativeId) {
      throw new AppError({
        code: ErrorCode.UPSTREAM_UNAVAILABLE,
        message: `${entry.provider} is not configured. Add the API key (and reference id) before previewing ${entry.label}.`,
      });
    }
    if (entry.provider === "cartesia" && this.cartesia) {
      return this.cartesia.streamSynthesize(text, nativeId, onAudio, signal, entry.language);
    }
    if (impl.streamSynthesize) {
      return impl.streamSynthesize(text, nativeId, onAudio, signal);
    }

    // Other catalog providers retain their existing full-clip path.
    const started = Date.now();
    const result =
      entry.provider === "cartesia" && this.cartesia
        ? await this.cartesia.synthesize(text, nativeId, signal, entry.language)
        : await impl.synthesize(text, nativeId, signal);
    onAudio(result.audio);
    return { firstChunkLatencyMs: Date.now() - started, latencyMs: result.latencyMs };
  }
}

export function createCatalogTextToSpeech(options: CatalogTtsOptions): CatalogTextToSpeech | null {
  if (
    !options.upliftApiKey &&
    !options.cartesiaApiKey &&
    !options.fishApiKey &&
    !options.elevenLabsApiKey
  ) {
    return null;
  }
  return new CatalogTextToSpeech(options);
}
