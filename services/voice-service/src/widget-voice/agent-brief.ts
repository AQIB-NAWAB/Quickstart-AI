import { createHash, randomUUID } from "node:crypto";
import type { Logger } from "@quickstart/logging";

const ENGLISH_DEMO_VOICE_ID = "cartesia:6c756032-11c3-4be8-a120-74f9673fb700";

const SPOKEN_STYLE = [
  "Speak as this published QuickStart AI agent on a live voice call.",
  "Use the agent instructions and product facts below. Do not invent pricing, security claims, or product features that are not written there.",
  "If a detail is missing, say you are not sure and offer to have the QuickStart team follow up.",
  "Answer in one or two short spoken sentences as soon as the visitor finishes a thought.",
  "If the visitor asks for a person, use consult_agent to follow the published agent's confirmation and handoff policy. Never announce a transfer before it is confirmed.",
  "No markdown, lists, URLs, or stage directions.",
].join(" ");

const FALLBACK_BRIEF = [
  "You are the voice of QuickStart AI, an embeddable support platform for website chat and voice.",
  "Help with the product, how to embed it, and what the published agent is allowed to say.",
  SPOKEN_STYLE,
].join(" ");

type AgentJson = {
  name?: string;
  instructions?: string;
  production_version_id?: string | null;
  voice?: { tts_voice_id?: string; language?: string };
};

type VersionJson = {
  snapshot?: {
    name?: string;
    instructions?: string;
    voice?: { tts_voice_id?: string; language?: string };
  };
};

type AgentProfile = {
  name: string;
  instructions: string;
  ttsVoiceId: string;
  language: string;
};

export type WidgetVoicePack = {
  brief: string;
  ttsVoiceId: string;
  language: string;
};

/** Agent instructions/voice are stable for a call; cache them briefly. */
const AGENT_CACHE_TTL_MS = 60_000;
const KNOWLEDGE_CACHE_TTL_MS = 30_000;
const CACHE_MAX_ENTRIES = 200;
const cache = new Map<string, { expiresAt: number; value: unknown }>();

function cacheGet<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return entry.value as T;
}

function cacheSet(key: string, value: unknown, ttlMs: number): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { expiresAt: Date.now() + ttlMs, value });
}

function knowledgeKey(workspaceId: string, query: string): string {
  const hash = createHash("sha256").update(query).digest("hex").slice(0, 20);
  return `knowledge:${workspaceId}:${hash}`;
}

/** "default" is a placeholder, not a catalog voice id. */
function catalogVoiceId(value: string | undefined): string | null {
  const id = value?.trim();
  if (!id || id === "default") return null;
  return id;
}

async function getJson<T>(url: string, token: string, requestId: string): Promise<T | null> {
  const res = await fetch(url, {
    headers: {
      authorization: `Bearer ${token}`,
      accept: "application/json",
      "x-request-id": requestId,
    },
  });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

/**
 * Load the same published agent the website chat uses, plus a short knowledge
 * slice, so Gemini Live speaks as QuickStart rather than a generic voice bot.
 * Failures fall back to a QuickStart brand line so the call still starts.
 */
export async function loadWidgetVoiceBrief(input: {
  workspaceId: string;
  conversationId: string;
  conversationUrl: string;
  agentUrl: string;
  knowledgeUrl: string;
  internalToken: string;
  logger: Logger;
  runtimeKnowledge?: boolean;
}): Promise<WidgetVoicePack> {
  const requestId = randomUUID();
  try {
    const conversation = await getJson<{ conversation?: { agent_id?: string | null } }>(
      `${input.conversationUrl}/internal/workspaces/${encodeURIComponent(input.workspaceId)}/widget/conversations/${encodeURIComponent(input.conversationId)}`,
      input.internalToken,
      requestId,
    );
    const agentId = conversation?.conversation?.agent_id?.trim();
    if (!agentId)
      return { brief: FALLBACK_BRIEF, ttsVoiceId: ENGLISH_DEMO_VOICE_ID, language: "en" };

    const profileKey = `agent:${input.workspaceId}:${agentId}`;
    let profile = cacheGet<AgentProfile>(profileKey);
    if (!profile) {
      const agentRes = await getJson<{ agent?: AgentJson }>(
        `${input.agentUrl}/internal/workspaces/${encodeURIComponent(input.workspaceId)}/widget/agents/${encodeURIComponent(agentId)}`,
        input.internalToken,
        requestId,
      );
      const agent = agentRes?.agent;
      let name = agent?.name?.trim() || "QuickStart AI";
      let instructions = agent?.instructions?.trim() || "";
      let ttsVoiceId = catalogVoiceId(agent?.voice?.tts_voice_id) ?? ENGLISH_DEMO_VOICE_ID;
      let language = agent?.voice?.language?.trim() || "en";
      const versionId = agent?.production_version_id?.trim();
      if (versionId) {
        const version = await getJson<{ version?: VersionJson }>(
          `${input.agentUrl}/internal/workspaces/${encodeURIComponent(input.workspaceId)}/widget/agents/${encodeURIComponent(agentId)}/versions/${encodeURIComponent(versionId)}`,
          input.internalToken,
          requestId,
        );
        const snapshot = version?.version?.snapshot;
        if (snapshot?.instructions?.trim()) instructions = snapshot.instructions.trim();
        if (snapshot?.name?.trim()) name = snapshot.name.trim();
        if (snapshot?.voice?.tts_voice_id?.trim()) {
          ttsVoiceId = catalogVoiceId(snapshot.voice.tts_voice_id) ?? ttsVoiceId;
        }
        if (snapshot?.voice?.language?.trim()) language = snapshot.voice.language.trim();
      }
      profile = { name, instructions, ttsVoiceId, language };
      cacheSet(profileKey, profile, AGENT_CACHE_TTL_MS);
    }

    const query = `${profile.name}. ${profile.instructions}`.slice(0, 500);
    const factsKey = knowledgeKey(input.workspaceId, query);
    let facts = cacheGet<string>(factsKey);
    if (input.runtimeKnowledge) facts = "";
    if (facts === null) {
      facts = "";
      try {
        const retrieved = await fetch(`${input.knowledgeUrl}/internal/retrieve`, {
          method: "POST",
          headers: {
            authorization: `Bearer ${input.internalToken}`,
            "content-type": "application/json",
            "x-request-id": requestId,
          },
          body: JSON.stringify({ workspace_id: input.workspaceId, query, limit: 4 }),
        });
        if (retrieved.ok) {
          const body = (await retrieved.json()) as { chunks?: Array<{ text?: string }> };
          facts = (body.chunks ?? [])
            .map((chunk) => chunk.text?.trim())
            .filter((text): text is string => Boolean(text))
            .join("\n")
            .slice(0, 1800);
        }
      } catch {
        facts = "";
      }
      cacheSet(factsKey, facts, KNOWLEDGE_CACHE_TTL_MS);
    }

    const parts = [
      `You are ${profile.name}, the published voice agent for QuickStart AI.`,
      profile.instructions ? `Agent instructions:\n${profile.instructions}` : "",
      facts ? `Product facts:\n${facts}` : "",
      SPOKEN_STYLE,
    ].filter(Boolean);
    input.logger.info("widget.voice.brief_loaded", {
      agent_id: agentId,
      chars: parts.join("\n\n").length,
      knowledge: Boolean(facts),
      voice_id: profile.ttsVoiceId,
    });
    return {
      brief: parts.join("\n\n").slice(0, 6000),
      ttsVoiceId: profile.ttsVoiceId,
      language: profile.language,
    };
  } catch (err) {
    input.logger.warn("widget.voice.brief_failed", {
      message: err instanceof Error ? err.message : "brief failed",
    });
    return { brief: FALLBACK_BRIEF, ttsVoiceId: ENGLISH_DEMO_VOICE_ID, language: "en" };
  }
}
