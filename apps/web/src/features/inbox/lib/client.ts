import type { Conversation, ConversationState, Message } from "./types";

type ApiError = { error: { code: string; message: string; request_id?: string } };

async function bff<T>(path: string, init?: RequestInit): Promise<{ data?: T; error?: ApiError["error"] }> {
  const res = await fetch(path, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as T | ApiError;
  if (!res.ok) {
    const err = body as ApiError;
    return {
      error: err.error ?? {
        code: `HTTP_${res.status}`,
        message: res.statusText || "Request failed",
      },
    };
  }
  return { data: body as T };
}

export async function listConversations(
  workspaceId: string,
  options?: { state?: ConversationState; limit?: number },
): Promise<{ conversations?: Conversation[]; error?: ApiError["error"] }> {
  const params = new URLSearchParams();
  if (options?.state) {
    params.set("state", options.state);
  }
  if (options?.limit) {
    params.set("limit", String(options.limit));
  }
  const q = params.toString();
  const { data, error } = await bff<{ conversations: Conversation[] }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/conversations${q ? `?${q}` : ""}`,
  );
  return error ? { error } : { conversations: data!.conversations };
}

export async function getConversation(
  workspaceId: string,
  conversationId: string,
): Promise<{ conversation?: Conversation; error?: ApiError["error"] }> {
  const { data, error } = await bff<{ conversation: Conversation }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}`,
  );
  return error ? { error } : { conversation: data!.conversation };
}

export async function listMessages(
  workspaceId: string,
  conversationId: string,
  options?: { afterSeq?: number; limit?: number },
): Promise<{ messages?: Message[]; error?: ApiError["error"] }> {
  const params = new URLSearchParams();
  if (options?.afterSeq !== undefined) {
    params.set("after_seq", String(options.afterSeq));
  }
  if (options?.limit) {
    params.set("limit", String(options.limit));
  }
  const q = params.toString();
  const { data, error } = await bff<{ messages: Message[] }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/messages${q ? `?${q}` : ""}`,
  );
  return error ? { error } : { messages: data!.messages };
}

export async function takeConversation(
  workspaceId: string,
  conversationId: string,
): Promise<{ conversation?: Conversation; error?: ApiError["error"] }> {
  const { data, error } = await bff<{ conversation: Conversation }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/take`,
    { method: "POST" },
  );
  return error ? { error } : { conversation: data!.conversation };
}

export async function releaseConversation(
  workspaceId: string,
  conversationId: string,
): Promise<{ conversation?: Conversation; error?: ApiError["error"] }> {
  const { data, error } = await bff<{ conversation: Conversation }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/release`,
    { method: "POST" },
  );
  return error ? { error } : { conversation: data!.conversation };
}

export async function summarizeConversation(
  workspaceId: string,
  conversationId: string,
): Promise<{ summary?: string | null; ready?: boolean; error?: ApiError["error"] }> {
  const { data, error } = await bff<{ summary: string | null; ready: boolean }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/summary`,
    { method: "POST" },
  );
  return error ? { error } : { summary: data!.summary, ready: data!.ready };
}

export type WidgetLiveCall = {
  conversation_id: string;
  needs_human: boolean;
  mode: "model" | "holding" | "human";
  human_name: string | null;
};

export async function listWidgetLiveCalls(
  workspaceId: string,
): Promise<{ calls?: WidgetLiveCall[]; error?: ApiError["error"] }> {
  const { data, error } = await bff<{ calls: WidgetLiveCall[] }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/voice/widget-live`,
  );
  return error ? { error } : { calls: data!.calls };
}

export async function getWidgetLiveCall(
  workspaceId: string,
  conversationId: string,
): Promise<{ live?: boolean; call?: WidgetLiveCall | null; error?: ApiError["error"] }> {
  const { data, error } = await bff<{ live: boolean; call: WidgetLiveCall | null }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/voice/widget-live/${encodeURIComponent(conversationId)}`,
  );
  return error ? { error } : { live: data!.live, call: data!.call };
}

export async function stopWidgetLiveCall(
  workspaceId: string,
  conversationId: string,
): Promise<{ error?: ApiError["error"] }> {
  const { error } = await bff(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/voice/widget-live/${encodeURIComponent(conversationId)}/stop`,
    { method: "POST" },
  );
  return { error };
}

export async function joinWidgetCall(
  workspaceId: string,
  conversationId: string,
  displayName: string,
): Promise<{ error?: ApiError["error"] }> {
  const { error } = await bff(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/voice/widget-live/${encodeURIComponent(conversationId)}/join`,
    { method: "POST", body: JSON.stringify({ display_name: displayName }) },
  );
  return { error };
}

export async function leaveWidgetCall(
  workspaceId: string,
  conversationId: string,
): Promise<{ error?: ApiError["error"] }> {
  const { error } = await bff(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/voice/widget-live/${encodeURIComponent(conversationId)}/leave`,
    { method: "POST" },
  );
  return { error };
}

export async function sendWidgetCallAudio(
  workspaceId: string,
  conversationId: string,
  pcmB64: string,
): Promise<void> {
  await bff(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/voice/widget-live/${encodeURIComponent(conversationId)}/audio`,
    { method: "POST", body: JSON.stringify({ pcm_b64: pcmB64 }) },
  );
}

export async function sendHumanMessage(
  workspaceId: string,
  conversationId: string,
  text: string,
  idempotencyKey: string,
): Promise<{ message?: Message; error?: ApiError["error"] }> {
  const { data, error } = await bff<{ message: Message }>(
    `/api/workspaces/${encodeURIComponent(workspaceId)}/conversations/${encodeURIComponent(conversationId)}/messages`,
    {
      method: "POST",
      body: JSON.stringify({
        text,
        sender_type: "human",
        idempotency_key: idempotencyKey,
      }),
    },
  );
  return error ? { error } : { message: data!.message };
}
