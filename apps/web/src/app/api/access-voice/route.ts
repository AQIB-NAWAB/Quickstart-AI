import { NextResponse } from "next/server";

const limits = new Map<string, { count: number; until: number }>();

export async function POST(request: Request) {
  const key = process.env.GEMINI_API_KEY;
  if (!key && !process.env.CARTESIA_API_KEY && !process.env.FISH_AUDIO_API_KEY) return NextResponse.json({ error: "Voice is unavailable right now." }, { status: 503 });
  const ip = request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() || "unknown";
  const now = Date.now();
  for (const [id, limit] of limits) if (limit.until < now) limits.delete(id);
  const limit = limits.get(ip);
  if (limit && limit.until > now && limit.count >= 12) return NextResponse.json({ error: "The voice preview limit has been reached." }, { status: 429 });
  limits.set(ip, limit && limit.until > now ? { ...limit, count: limit.count + 1 } : { count: 1, until: now + 600_000 });
  let text: unknown;
  try { ({ text } = await request.json()); } catch { return NextResponse.json({ error: "Invalid request." }, { status: 400 }); }
  if (typeof text !== "string" || !text.trim() || text.length > 400) return NextResponse.json({ error: "Invalid request." }, { status: 400 });
  if (process.env.FISH_AUDIO_API_KEY) {
    try {
      const reference = process.env.ACCESS_ASSISTANT_FISH_VOICE || process.env.FISH_AUDIO_REFERENCE_ID;
      const fish = await fetch("https://api.fish.audio/v1/tts", {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.FISH_AUDIO_API_KEY}`, "Content-Type": "application/json", model: process.env.ACCESS_ASSISTANT_FISH_MODEL || "s2.1-pro-free" },
        body: JSON.stringify({ text, format: "mp3", latency: "low", temperature: 0.5, ...(reference ? { reference_id: reference } : {}) }),
        signal: AbortSignal.timeout(20000),
      });
      if (fish.ok && fish.body) return new Response(fish.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store", "X-Voice-Provider": "fish" } });
    } catch { /* Fall back when Fish is unavailable. */ }
  }
  try {
    if (!key) throw new Error("Gemini is not configured");
    const model = process.env.ACCESS_ASSISTANT_TTS_MODEL || "gemini-3.8-flash-lite-tts";
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`, {
      method: "POST", headers: { "Content-Type": "application/json", "x-goog-api-key": key },
      body: JSON.stringify({ contents: [{ parts: [{ text }] }], generationConfig: { responseModalities: ["AUDIO"], speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: "Kore" } } } } }),
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) throw new Error(`Voice provider returned ${response.status}`);
    const data = await response.json() as { candidates?: Array<{ content?: { parts?: Array<{ inlineData?: { data?: string; mimeType?: string } }> } }> };
    const audio = data.candidates?.[0]?.content?.parts?.find((part) => part.inlineData?.data)?.inlineData;
    if (!audio?.data) throw new Error("No audio returned");
    const bytes = Buffer.from(audio.data, "base64");
    if (audio.mimeType?.includes("wav") || bytes.toString("ascii", 0, 4) === "RIFF") return new Response(bytes, { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
    const header = Buffer.alloc(44);
    header.write("RIFF", 0); header.writeUInt32LE(36 + bytes.length, 4); header.write("WAVEfmt ", 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22); header.writeUInt32LE(24000, 24); header.writeUInt32LE(48000, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34); header.write("data", 36); header.writeUInt32LE(bytes.length, 40);
    return new Response(Buffer.concat([header, bytes]), { headers: { "Content-Type": "audio/wav", "Cache-Control": "no-store" } });
  } catch {
    const cartesiaKey = process.env.CARTESIA_API_KEY;
    if (cartesiaKey) {
      try {
        const fallback = await fetch("https://api.cartesia.ai/tts/bytes", {
          method: "POST",
          headers: { "Content-Type": "application/json", "X-API-Key": cartesiaKey, "Cartesia-Version": "2024-06-10" },
          body: JSON.stringify({ model_id: process.env.CARTESIA_MODEL || "sonic-3.6", transcript: text, voice: { mode: "id", id: process.env.ACCESS_ASSISTANT_CARTESIA_VOICE || "6c756032-11c3-4be8-a120-74f9673fb700" }, output_format: { container: "mp3", sample_rate: 44100, bit_rate: 128000 }, language: "en" }),
          signal: AbortSignal.timeout(20000),
        });
        if (fallback.ok) return new Response(await fallback.arrayBuffer(), { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "no-store" } });
      } catch { /* Report the shared voice error below. */ }
    }
    return NextResponse.json({ error: "The voice service couldn’t respond. Please try again." }, { status: 502 });
  }
}
