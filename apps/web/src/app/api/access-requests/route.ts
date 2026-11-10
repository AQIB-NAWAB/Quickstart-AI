import { NextResponse } from "next/server";

const DEFAULT_ACCESS_REQUEST_WEBHOOK =
  "https://script.google.com/macros/s/AKfycby3Uv0-ldtgsnlw1icKnBLuL0Ig5iQNBui7s-MryUqgIrQrflGK1j4ynyUOAiiPE4wy/exec";

export async function POST(request: Request) {
  const webhookUrl = process.env.ACCESS_REQUEST_WEBHOOK_URL || DEFAULT_ACCESS_REQUEST_WEBHOOK;

  let email: unknown;
  let fullName: unknown;
  let useCase: unknown;
  try { ({ email, fullName, useCase } = await request.json()); } catch { return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 }); }
  if (typeof email !== "string" || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
    || (fullName !== undefined && (typeof fullName !== "string" || fullName.length > 120))
    || (useCase !== undefined && (typeof useCase !== "string" || useCase.length > 500))) {
    return NextResponse.json({ error: "Enter a valid email address." }, { status: 400 });
  }

  try {
    const result = await fetch(webhookUrl, {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        "Timestamp": new Date().toISOString(),
        "Email Address": email,
        "Full Name": typeof fullName === "string" ? fullName : "",
        "How do you plan to use QuickStart AI?": typeof useCase === "string" ? useCase : "",
        // Friendly aliases for Apps Script implementations that use camelCase fields.
        timestamp: new Date().toISOString(),
        email,
        name: typeof fullName === "string" ? fullName : "",
        fullName: typeof fullName === "string" ? fullName : "",
        useCase: typeof useCase === "string" ? useCase : "",
        source: "quickstart-request-access",
      }),
      signal: AbortSignal.timeout(20000),
    });
    if (!result.ok || new URL(result.url).hostname === "accounts.google.com") throw new Error("Webhook rejected request");
    const responseText = await result.text();
    if (/"success"\s*:\s*false|"error"\s*:|error:|class="errorMessage"|script function not found/i.test(responseText)) throw new Error("Webhook rejected request");
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "We couldn’t send your request right now. Please try again shortly." }, { status: 502 });
  }
}
