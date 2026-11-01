import type { AgentToolDefinition } from "@quickstart/contracts";

export const VOICE_TRANSFER_TOOL_NAME = "transfer_to_teammate";

/** Runtime-only function. It is not saved on the agent. The tool loop handles it by name. */
export const VOICE_TRANSFER_TOOL: AgentToolDefinition = {
  id: "voice-transfer",
  name: VOICE_TRANSFER_TOOL_NAME,
  description:
    "Connect this live call to a human teammate. Call this only after the visitor asked for a person and then said yes.",
  type: "http",
  method: "POST",
  base_url: "https://transfer.invalid",
  allowed_hosts: ["transfer.invalid"],
  parameters: { type: "object", properties: {} },
};

/** Voice stays on the streamed answer path unless the caller asked for an action. */
export function utteranceRequestsAction(text: string | undefined): boolean {
  const value = text?.trim() ?? "";
  if (!value) return false;
  return (
    visitorRequestsToolAction(value) ||
    /\b(look\s*up|lookup|fetch|check (my|the|this|that|available|open)|find (my|the)|search for|scrape|create|update|delete|cancel|order status|post id|track my|book|book a|book an|book the|run the|slots|slot|appointment|appointments|call me|call back|callback|phone me|ring me|schedule a call|availability|anything (open|available)|open (slot|slots)|free (slot|slots)|opening|openings|quote|demo|trial|sign up|signup|interested|our team|for our team|work for our|would this work)\b|چیک کرو|ڈھونڈ|کینسل|بک کرو|بک کریں|کال کریں|کال بیک|\b(?:check karo|check karein|dekh ke batao|dhoondo|dhoondho|booking karni|book kar|book karein|cancel kar|cancel karein|slot check|appointment book|call karo|call karein)\b/i.test(
      value,
    )
  );
}

/** Chat and widget tools are available only for a clear request to perform a lookup or action. */
export function visitorRequestsToolAction(text: string | undefined): boolean {
  const value = text?.trim() ?? "";
  if (!value) return false;
  return (
    /\b(?:look\s*up|lookup|search(?:\s+for)?|fetch|retrieve|pull\s+up|track|query|check|show|see|open|get|tell)\b.{0,70}\b(?:order|post|ticket|invoice|run|record|account|shipment|booking|payment|lead|customer|slot|slots|appointment|appointments)\b|\b(?:create|update|delete|cancel|book|run|schedule)\s+(?:a|an|the|my|this|it)?\s*(?:order|post|ticket|invoice|run|record|account|shipment|booking|payment|lead|customer|slot|slots|appointment|appointments|it|this)\b|چیک کرو|ڈھونڈ|کینسل|بک کرو|بک کریں|کینسل کریں|\b(?:check karo|check karein|dekh ke batao|dhoondo|dhoondho|booking karni|book kar|book karein|cancel kar|cancel karein|slot check|appointment book)\b/i.test(
      value,
    ) ||
    /\b(?:details?|information)\s+(?:of|for|about)\s+(?:(?:the|a|an|my|this|that)\s+)?(?:order|post|ticket|invoice|run|record|account|shipment|booking|payment|lead|customer)\b/i.test(
      value,
    ) ||
    /\b(?:call|phone|ring)\s+(?:me|us)\b|\bcall\s*back\b|\bcallback\b|\bschedule\s+(?:a\s+)?call\b|کال کریں|کال بیک|\b(?:call karo|call karein)\b/i.test(
      value,
    ) ||
    /\b(?:availability|anything (?:open|available)|open (?:slot|slots)|free (?:slot|slots)|opening|openings)\b/i.test(
      value,
    ) ||
    /\b(?:book|quote|demo|trial|sign up|signup|interested|our team|for our team|work for our|would this work)\b/i.test(
      value,
    )
  );
}

export function assistantAskedForLookupTarget(text: string | undefined): boolean {
  return (
    /\b(?:which|what).{0,50}\b(?:post|order|ticket|invoice|run|record|account|shipment|booking|payment|lead|customer|slot|appointment)(?:\s+id)?\b|\b(?:which|what).{0,40}\b(?:id|identifier|number|time|slot)\b/i.test(
      text ?? "",
    ) ||
    /\b(?:share|provide|give|tell me)\b.{0,40}\b(?:the\s+)?(?:id|identifier|number)\b/i.test(
      text ?? "",
    )
  );
}

export function visitorSuppliedIdentifier(text: string | undefined): boolean {
  const value = text ?? "";
  const numberWord =
    "zero|one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|aik|ek|do|teen|char|chaar|paanch|chheh|saat|aath|nau|das|dus";
  return new RegExp(
    `^\\s*#?\\s*(?:\\d+|[۰-۹]+|${numberWord})[.!?]?\\s*$|\\b(?:id|number|no|number hai|id hai)\\s*(?:(?:is|with|of|number|hai)\\s*)?#?\\s*(?:\\d+[a-z0-9-]*|[۰-۹]+|${numberWord})\\b|#\\s*\\d+\\b|\\b(?:post|order|ticket|invoice|run|record|account|shipment|booking|payment|lead|customer|slot)\\s+#?\\s*(?:\\d+|[۰-۹]+|${numberWord})\\b`,
    "i",
  ).test(value);
}

export function lookupRequestMissingIdentifier(text: string | undefined): boolean {
  const value = text ?? "";
  if (/\b(?:slot|slots|available|appointment|schedule)\b/i.test(value)) return false;
  const isLookupVerb =
    /\b(?:look\s*up|lookup|search|fetch|retrieve|pull\s+up|track|query|check|show|see|open|get|details?|information)\b/i.test(
      value,
    );
  const mentionsRecord =
    /\b(?:post|order|ticket|invoice|run|record|account|shipment|booking|payment|lead|customer)\b/i.test(
      value,
    );
  return (
    isLookupVerb &&
    visitorRequestsToolAction(value) &&
    mentionsRecord &&
    !visitorSuppliedIdentifier(value)
  );
}

export function assistantAskedForActionConfirmation(text: string | undefined): boolean {
  return /\b(?:please\s+confirm|reply\s+yes\s+to|confirm\s+if\s+i\s+should|just\s+to\s+confirm|correct\?|(?:should|shall)\s+i\s+(?:create|update|delete|cancel|start|go\s+ahead|proceed|book)|would\s+you\s+like\s+me\s+to\s+(?:create|update|delete|cancel|start|proceed|go\s+ahead|book)|do\s+you\s+want\s+me\s+to\s+(?:create|update|delete|cancel|start|proceed|go\s+ahead|book))\b/i.test(
    text ?? "",
  );
}

export function visitorWantsTeammate(text: string | undefined): boolean {
  const value = text?.trim() ?? "";
  if (!value) return false;
  return /\b(talk|speak|switch|transfer|connect|hand)\b.{0,40}\b(human|person|teammate|representative|operator|agent)\b|\b(human|live) (agent|person|support)\b|انسان سے بات|ساتھی سے بات|بندے سے بات|نمائندے سے بات|\b(bande|insan|human|representative|agent) se (baat|connect)\b/i.test(
    value,
  );
}

/** The previous spoken line asked before handing the call to a person. */
export function assistantOfferedHandoff(text: string | undefined): boolean {
  return /connect you with a teammate|ساتھی سے ملا دوں/i.test(text ?? "");
}

export function spokenToolNudge(
  toolName: string,
  language: string | undefined,
  gender: "female" | "male" | "neutral" | undefined = "male",
): string {
  const lang = (language ?? "").toLowerCase();
  const urdu = lang.startsWith("ur");
  const feminine = gender === "female";
  if (toolName === VOICE_TRANSFER_TOOL_NAME) {
    return urdu
      ? feminine
        ? "ٹھیک ہے، میں آپ کو ایک ساتھی کے پاس بھیج رہی ہوں۔"
        : "ٹھیک ہے، میں آپ کو ایک ساتھی کے پاس بھیج رہا ہوں۔"
      : "Okay, I'm switching you to a teammate right now.";
  }
  const name = toolName.toLowerCase();
  if (/fetch|get|lookup|search|scrape|retrieve|list/.test(name)) {
    return urdu
      ? feminine
        ? "ٹھیک ہے، میں یہ لا رہی ہوں۔"
        : "ٹھیک ہے، میں یہ لا رہا ہوں۔"
      : "I'm fetching that now.";
  }
  if (/status|check/.test(name)) {
    return urdu
      ? feminine
        ? "ٹھیک ہے، میں یہ چیک کر رہی ہوں۔"
        : "ٹھیک ہے، میں یہ چیک کر رہا ہوں۔"
      : "I'm checking that.";
  }
  if (urdu) {
    return feminine ? "ٹھیک ہے، میں یہ چیک کر رہی ہوں۔" : "ٹھیک ہے، میں یہ چیک کر رہا ہوں۔";
  }
  return "Checking that for you right now.";
}

/** Writes, starts, and cancels wait for a yes. Lookups and direct bookings the visitor already asked for do not. */
export function toolChangesData(tool: AgentToolDefinition | undefined): boolean {
  if (!tool || tool.name === VOICE_TRANSFER_TOOL_NAME) return false;
  const lowerName = tool.name.toLowerCase();
  if (lowerName.includes("cancel") || lowerName.includes("delete") || lowerName.includes("remove"))
    return true;
  if (tool.name === "book_dental_slot") return false;
  if (tool.type === "http" && tool.method !== "GET") return true;
  if (tool.type === "builtin_leads" && (tool.action === "start" || tool.action === "cancel"))
    return true;
  return false;
}

export function visitorConfirmed(text: string | undefined): boolean {
  // A yes followed by a refusal is not authorization. Realtime transcripts can
  // include corrections such as "yes, but do not book anything yet".
  if (
    /^\s*(?:no|nope|nah)\b|\b(?:do not|don't|not yet|not now|wait|stop|hold on|never mind|but no|abhi nahi|abhi nahin|mat karo|mat karein)\b|(?:^|\s)(?:نہیں|مت)(?:\s|[۔،؟.!?]|$)/iu.test(
      text ?? "",
    )
  )
    return false;
  return /\b(yes|yeah|yep|sure|ok|okay|go ahead|please do|confirm|do it|haan|han|haa|haanji|theek|thik|theek hai|thik hai|sahi hai|bilkul|kar do|kar dein|kardo|kardein|zaroor|chalega|ہاں|جی|جی ہاں|بالکل|ٹھیک ہے|ضرور)\b/i.test(
    text ?? "",
  );
}

export const CONVERSATION_PRIORITY = [
  "HOW TO ANSWER (highest priority — overrides any urge to collect ids):",
  "For a normal question, explanation, or small talk, answer from the agent instructions and the knowledge snippets. Do not call a tool. Do not ask for a post id, order id, or any other identifier.",
  "Call a tool only when the visitor clearly asks you to look something up, fetch it, search, scrape, create, update, or cancel, and you already have every required detail.",
  "If they asked for that action but one required detail is missing, ask one short question for that detail. Never open a normal conversation by asking which id they mean.",
  "Before a tool that creates, updates, deletes, starts, or cancels something, ask one short confirmation and wait for a yes. Do not call it until they agree.",
  "A read-only lookup they already asked for can run immediately. Do not say the function name. Never invent an id, and never reuse an id from an earlier turn unless they just referred to that same thing.",
  "ANTI-HALLUCINATION GUARD (strict): When a tool lookup or knowledge query returns empty results, 'not found', or zero items, state clearly and truthfully that no matching records exist. NEVER fabricate, guess, or assume fake IDs, mock appointment slots, or false order confirmations.",
].join("\n");
