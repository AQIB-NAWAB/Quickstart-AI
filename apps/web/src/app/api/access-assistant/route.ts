import { NextResponse } from "next/server";
import { PRODUCT_BRIEF } from "@/lib/server/marketing/product-brief";
import { extractSpokenEmail } from "@/lib/server/marketing/spoken-email";

const limits = new Map<string, { count: number; until: number }>();
const validSteps = ["name", "email", "useCase", "confirm"] as const;

export async function POST(request: Request) {
  const key = process.env.GROQ_API_KEY;
  if (!key) return NextResponse.json({ error: "The conversation service is unavailable." }, { status: 503 });
  const ip = request.headers.get("x-forwarded-for")?.split(",").pop()?.trim() || "unknown";
  const now = Date.now();
  for (const [id, value] of limits) if (value.until <= now) limits.delete(id);
  const previous = limits.get(ip);
  if (previous && previous.until > now && previous.count >= 12) return NextResponse.json({ error: "The demo limit has been reached." }, { status: 429 });
  limits.set(ip, previous && previous.until > now ? { ...previous, count: previous.count + 1 } : { count: 1, until: now + 600_000 });
  let payload: { message?: unknown; step?: unknown; name?: unknown; email?: unknown; useCase?: unknown; history?: unknown };
  try { payload = await request.json(); } catch { return NextResponse.json({ error: "Please try again." }, { status: 400 }); }
  const { message } = payload;
  if (typeof message !== "string" || !message.trim() || message.length > 500) return NextResponse.json({ error: "Please keep your answer under 500 characters." }, { status: 400 });
  const step = typeof payload.step === "string" && validSteps.includes(payload.step as typeof validSteps[number]) ? payload.step : "name";
  const safe = (value: unknown) => typeof value === "string" ? value.slice(0, 500) : "";
  const history = Array.isArray(payload.history) ? payload.history.slice(-6).filter((m): m is { role: "user" | "assistant"; content: string } => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string" && m.content.length <= 500) : [];
  try {
    const model = process.env.ACCESS_ASSISTANT_GROQ_MODEL || "openai/gpt-oss-120b";
    const result = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: `You are a friendly, natural voice guide for QuickStart AI. Use this product brief to answer questions accurately:\n${PRODUCT_BRIEF}\nWelcome visitors and answer questions before collecting details. Ask for a name only when the visitor wants access or volunteers it. Guide them through the request, one question at a time. Current requested field: ${step}. Existing details: ${JSON.stringify({ name: safe(payload.name), email: safe(payload.email), useCase: safe(payload.useCase) })}. A visitor may correct or spell any previously captured field at any time; update that field immediately, acknowledge the correction, and continue naturally. For a spelled name join the letters into a name, e.g. A Q I P becomes Aqip. Strip filler from names. Convert spoken email phrases like 'at', 'at the rate', and 'dot' into email syntax without guessing unclear characters. A visitor can spell the email over multiple turns: use the recent conversation to combine the parts; when it is incomplete, ask for the missing part instead of guessing. Ask them to check the email shown on screen after capturing it. If they skip the optional use case set skipUseCase true. If 'escape' is given alone as the use case, ask whether they meant skip. Before submitting, ask the visitor to check the displayed name and email. Never say the request is submitted; the app handles that only after explicit confirmation. Keep reply under 25 words for quick voice playback. Respond ONLY with a JSON object with keys reply (short spoken reply), name (string or null), email (string or null), useCase (string or null), skipUseCase (boolean).` },
          ...history,
          { role: "user", content: message.trim() },
        ],
        response_format: { type: "json_object" }, max_completion_tokens: 512, temperature: 0.3,
        ...(model.startsWith("openai/gpt-oss-") ? { reasoning_effort: "low" } : {}),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!result.ok) throw new Error(`Groq returned HTTP ${result.status}`);
    const data = await result.json() as { choices?: Array<{ message?: { content?: string } }> };
    const raw = data.choices?.[0]?.message?.content;
    if (!raw) throw new Error("Groq returned an empty response");
    const parsed = JSON.parse(raw) as { reply?: unknown; name?: unknown; email?: unknown; useCase?: unknown; skipUseCase?: unknown };
    if (typeof parsed.reply !== "string" || !parsed.reply.trim()) throw new Error("Invalid response");
    const previousUser = [...history].reverse().find((item) => item.role === "user")?.content ?? "";
    const partialEmail = step === "email" && /^\s*(?:at\s+(?:the\s+rate\s+)?|@)/i.test(message) && /\b(email|e-mail|address)\b/i.test(previousUser)
      ? extractSpokenEmail(`${previousUser} ${message}`)
      : null;
    const spokenEmail = extractSpokenEmail(message) || partialEmail;
    const email = spokenEmail || safe(parsed.email).slice(0, 254);
    let reply = parsed.reply.slice(0, 400);
    if (spokenEmail && safe(parsed.email) && spokenEmail !== safe(parsed.email).toLowerCase()) reply = `I have ${spokenEmail}. Please check the email shown on screen. What would you like to use QuickStart AI for?`;
    if (email && email !== safe(payload.email) && !/check|confirm|verify|correct/i.test(reply)) reply = `${reply} Please check the email shown on screen.`.slice(0, 400);
    const previousAssistant = [...history].reverse().find((item) => item.role === "assistant")?.content ?? "";
    const explicitSkip = /\b(skip|pass|rather not|not now|no thanks)\b/i.test(message) || (/\bskip\b/i.test(previousAssistant) && /^(yes|yeah|yep|sure|please)[.! ]*$/i.test(message.trim()));
    return NextResponse.json({ reply, name: safe(parsed.name).slice(0, 120), email, useCase: safe(parsed.useCase), skipUseCase: step === "useCase" && parsed.skipUseCase === true && explicitSkip });
  } catch (error) {
    console.warn("Access assistant failed:", error instanceof SyntaxError ? "invalid model JSON" : error instanceof Error ? error.message : "unknown error");
    return NextResponse.json({ error: "The guide couldn’t respond just now. Please try again." }, { status: 502 });
  }
}
