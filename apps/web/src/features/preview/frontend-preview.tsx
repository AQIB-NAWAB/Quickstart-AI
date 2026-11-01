"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { AppShell } from "@/features/workspace/components/app-shell";
import { KnowledgeSourceList } from "@/features/knowledge/components/knowledge-source-list";
import { MemoryFacts } from "@/features/knowledge/components/memory-facts";
import { SourceDetails } from "@/features/knowledge/components/source-details";
import { WorkspaceSettings } from "@/features/settings/components/workspace-settings";
import { AgentList } from "@/features/agents/components/agent-list";
import { AgentEditor } from "@/features/agents/components/agent-editor";
import { CreateAgentForm } from "@/features/agents/components/create-agent-form";
import type { Agent } from "@/features/agents/lib/types";
import { InboxSidebar } from "@/features/inbox/components/inbox-sidebar";
import { ConversationThread } from "@/features/inbox/components/conversation-thread";
import { EmptyInboxState } from "@/features/inbox/components/empty-inbox-state";
import { TranscriptView } from "@/features/inbox/components/transcript-view";
import type { Conversation, Message } from "@/features/inbox/lib/types";
import { AnalyticsDashboard } from "@/features/analytics/components/analytics-dashboard";
import { createFixtureDataSource } from "@/features/analytics/lib/data-source";
import { WorkflowPreviewView } from "@/features/workflows/components/workflow-preview-view";
import { LeadsPage } from "@/features/leads/components/leads-page";
import { CampaignPreviewView } from "@/features/campaigns/components/campaign-preview-view";
import { VoicePreviewView } from "@/features/voice/components/voice-preview-view";
import { AuditList } from "@/features/audit/components/audit-list";
import { NotificationCenter } from "@/features/notifications/components/notification-center";
import { DeveloperPreviewView } from "@/features/developer/components/developer-preview-view";
import { EvaluationPreviewView } from "@/features/evaluation/components/evaluation-preview-view";
import type { KnowledgeSource, MemoryFact } from "@/features/knowledge/lib/types";

const workspace = {
  id: "local-preview",
  orgId: "local-preview-org",
  name: "Demo Workspace",
  slug: "demo",
};
const date = "2026-10-15T10:42:00.000Z";
const previewConversations: Conversation[] = [
  { id: "84b0cd", subject_key: "anon:84b0cd", state: "bot" },
  { id: "fdfa0c", subject_key: "anon:fdfa0c", state: "bot" },
].map((item, index) => ({
  ...item,
  state: item.state as Conversation["state"],
  workspace_id: workspace.id,
  agent_id: "support-assistant",
  assignee_user_id: item.state === "human" ? "preview-owner" : null,
  last_seq: index === 0 ? 2 : 1,
  created_at: index === 0 ? "2026-10-15T10:42:00.000Z" : "2026-10-15T10:39:00.000Z",
  updated_at:
    index === 0
      ? new Date(Date.now() - 120000).toISOString()
      : new Date(Date.now() - 300000).toISOString(),
}));
const previewAgents: Agent[] = [
  {
    id: "support-assistant",
    workspace_id: workspace.id,
    name: "Support assistant",
    description: "Answer product questions and help customers with orders.",
    instructions:
      "Help customers with product questions. Use the knowledge base for company policies and ask for clarification when needed.",
    environment: "production",
    model_settings: { model: "gpt-4o-mini", temperature: 0.3, max_tokens: 1024 },
    channels: { chat: true, voice: true },
    tools: [],
    version: 1,
    production_version_id: "preview-release-1",
    canary_version_id: null,
    canary_percentage: 0,
    created_at: date,
    updated_at: date,
  },
];
const sources: KnowledgeSource[] = [
  { name: "Customer support handbook.pdf", kind: "document", status: "ready", chunk_count: 42 },
  { name: "Product documentation", kind: "url", status: "ready", chunk_count: 86 },
  { name: "Shipping and returns policy", kind: "text", status: "ready", chunk_count: 12 },
  { name: "Onboarding guide.pdf", kind: "document", status: "processing", chunk_count: 8 },
  { name: "Release notes", kind: "text", status: "queued", chunk_count: 0 },
  { name: "Archived help center", kind: "url", status: "failed", chunk_count: 0 },
].map((source, index) => ({
  ...source,
  status: source.status as KnowledgeSource["status"],
  id: `source-${index + 1}`,
  workspace_id: workspace.id,
  error_message:
    source.status === "failed" ? "The source could not be retrieved. Please try again." : null,
  content_text:
    source.kind === "text"
      ? "Returns are accepted within 30 days. Standard shipping takes 3–5 business days."
      : null,
  storage_key: source.kind === "document" ? `preview/${index}.pdf` : null,
  content_type: source.kind === "document" ? "application/pdf" : "text/plain",
  version: 1,
  created_at: date,
  updated_at: date,
}));
const members = [
  { id: "member-1", userId: "preview-owner", role: "owner", email: "alex@example.com" },
  { id: "member-2", userId: "preview-developer", role: "developer", email: "jordan@example.com" },
  { id: "member-3", userId: "preview-analyst", role: "analyst", email: "sam@example.com" },
].map((member) => ({ ...member, workspaceId: workspace.id, createdAt: date }));
const keys = [
  { id: "api-key-1", name: "Production integration", key_prefix: "qsk_demo", created_at: date },
  { id: "api-key-2", name: "Development", key_prefix: "qsk_demo", created_at: date },
];
const secrets = ["OPENAI_API_KEY", "CRM_ACCESS_TOKEN", "WEBHOOK_SIGNING_SECRET"].map(
  (name, index) => ({
    id: `secret-${index}`,
    workspace_id: workspace.id,
    name,
    key_version: 1,
    created_at: date,
    updated_at: date,
  }),
);
const widgetKeys = [
  {
    id: "widget-1",
    workspace_id: workspace.id,
    name: "Support website",
    key_prefix: "pk_demo",
    allowed_origins: ["https://acme.example.com", "http://localhost:3005"],
    revoked_at: null,
    created_at: date,
    updated_at: date,
  },
];

export function FrontendPreview({ view }: { view: string[] }) {
  const [ready, setReady] = useState(false);
  const router = useRouter();
  useEffect(() => {
    const originalFetch = window.fetch;
    window.fetch = async (input, init) => {
      const url = new URL(
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url,
        window.location.origin,
      );
      if (url.origin !== window.location.origin || !url.pathname.startsWith("/api/"))
        return originalFetch(input, init);
      const method = (
        init?.method ?? (input instanceof Request ? input.method : "GET")
      ).toUpperCase();
      const reply = (body: unknown, status = 200) =>
        new Response(JSON.stringify(body), {
          status,
          headers: { "Content-Type": "application/json" },
        });
      // This development-only visual preview never sends API requests to real services.
      if (method === "POST" && url.pathname.endsWith("/summary")) {
        return reply({
          summary:
            "The visitor asked about pricing. The agent shared an overview and offered help choosing a plan.",
          ready: true,
        });
      }
      if (method !== "GET")
        return reply(
          {
            error: {
              code: "PREVIEW_READ_ONLY",
              message:
                "This preview uses sample data. Changes are disabled; connect the backend to save.",
            },
          },
          403,
        );
      const path = url.pathname;
      const conversationPrefix = `/api/workspaces/${workspace.id}/conversations`;
      if (path === conversationPrefix)
        return reply({
          conversations: previewConversations.filter(
            (item) =>
              !url.searchParams.get("state") || item.state === url.searchParams.get("state"),
          ),
        });
      if (path.startsWith(conversationPrefix + "/")) {
        const conversationId = path.slice(conversationPrefix.length + 1).split("/")[0];
        const conversation = previewConversations.find((item) => item.id === conversationId);
        if (!conversation) return reply({ error: { message: "Conversation not found" } }, 404);
        if (path.endsWith("/take")) {
          conversation.state = "human";
          conversation.assignee_user_id = "preview-owner";
          return reply({ conversation });
        }
        if (path.endsWith("/release")) {
          conversation.state = "bot";
          conversation.assignee_user_id = null;
          return reply({ conversation });
        }
        if (path.endsWith("/summary")) {
          return reply({
            summary:
              "The visitor asked about pricing. The agent shared an overview and offered help choosing a plan.",
            ready: true,
          });
        }
        if (path.endsWith("/messages")) {
          if (init?.method === "POST") {
            const body = init?.body ? JSON.parse(init.body as string) : {};
            const newMsg: Message = {
              id: `${conversation.id}-${Date.now()}`,
              workspace_id: workspace.id,
              conversation_id: conversation.id,
              seq: conversation.last_seq + 1,
              sender_type: "human",
              sender_id: "preview-owner",
              text: body.text || "",
              idempotency_key: body.idempotency_key || `preview-${Date.now()}`,
              created_at: new Date().toISOString(),
            };
            conversation.last_seq += 1;
            return reply({ message: newMsg });
          }
          const messages: Message[] =
            conversation.id === "84b0cd"
              ? [
                  {
                    id: "84b0cd-0",
                    workspace_id: workspace.id,
                    conversation_id: conversation.id,
                    seq: 1,
                    sender_type: "user",
                    sender_id: "sample-visitor",
                    text: "Can you tell me about your pricing?",
                    idempotency_key: "preview-0",
                    created_at: "2026-10-15T10:42:00.000Z",
                  },
                  {
                    id: "84b0cd-1",
                    workspace_id: workspace.id,
                    conversation_id: conversation.id,
                    seq: 2,
                    sender_type: "assistant",
                    sender_id: "support-assistant",
                    text: "Our plans depend on your team's needs. You can explore the options on our pricing page, or I can help you find the right fit.",
                    idempotency_key: "preview-1",
                    created_at: "2026-10-15T10:42:00.000Z",
                  },
                ]
              : [
                  {
                    id: "fdfa0c-0",
                    workspace_id: workspace.id,
                    conversation_id: conversation.id,
                    seq: 1,
                    sender_type: "user",
                    sender_id: "sample-visitor",
                    text: "Hello, I need help getting started.",
                    idempotency_key: "preview-0",
                    created_at: "2026-10-15T10:39:00.000Z",
                  },
                ];
          return reply({
            messages: messages
              .filter((item) => item.seq > Number(url.searchParams.get("after_seq") ?? 0))
              .slice(0, Number(url.searchParams.get("limit") ?? 50)),
          });
        }
        return reply({ conversation });
      }
      if (path === `/api/workspaces/${workspace.id}/knowledge/sources`)
        return reply({ sources, total: sources.length });
      if (path.startsWith(`/api/workspaces/${workspace.id}/knowledge/sources/`)) {
        const source = sources.find((item) => item.id === path.split("/").pop());
        return source ? reply({ source }) : reply({ error: { message: "Source not found" } }, 404);
      }
      if (path === `/api/workspaces/${workspace.id}/memory/facts`) {
        const subject = url.searchParams.get("subject_key") ?? "customer:123";
        const facts: MemoryFact[] = [
          "Prefers email updates instead of phone calls.",
          "Uses the Pro plan for a team of six.",
          "Primary timezone is Europe/London.",
          "Interested in the upcoming analytics integration.",
        ].map((fact_text, index) => ({
          id: `fact-${index}`,
          workspace_id: workspace.id,
          subject_key: subject,
          fact_key: ["contact_preference", "subscription", "timezone", "interest"][index],
          fact_text,
          created_at: date,
          updated_at: date,
        }));
        return reply({ facts, total: facts.length });
      }
      if (path.endsWith("/members")) return reply({ members });
      if (path.endsWith("/api-keys")) return reply({ api_keys: keys });
      if (path.endsWith("/secrets")) return reply({ secrets });
      if (path.endsWith("/publishable-keys")) return reply({ publishable_keys: widgetKeys });
      if (path === `/api/workspaces/${workspace.id}/voice/catalog`)
        return reply({
          voices: [
            [
              "uplift:v_8eelc901",
              "uplift",
              "Uplift Info",
              "ur-PK",
              "Clear Urdu, education and support.",
            ],
            ["uplift:v_30s70t3a", "uplift", "Uplift News", "ur-PK", "Pakistani news cadence."],
            [
              "uplift:v_meklc281",
              "uplift",
              "Uplift Urdu",
              "ur-PK",
              "Urdu female conversational voice.",
            ],
            [
              "cartesia:6c756032-11c3-4be8-a120-74f9673fb700",
              "cartesia",
              "Cartesia Harlow",
              "en",
              "Warm English support voice.",
            ],
            [
              "cartesia:d463004e-0353-4063-80d4-2fabbf1c5dcb",
              "cartesia",
              "Cartesia Hina",
              "ur",
              "Urdu, steady and clear.",
            ],
            ["fish:reference", "fish", "Fish reference", "en", "Custom workspace voice."],
          ].map(([id, provider, label, language, description]) => ({
            id,
            provider,
            label,
            language,
            description,
            available: false,
            sample_text: "Hello. How can I help?",
          })),
        });
      if (path === `/api/workspaces/${workspace.id}/agents`)
        return reply({ agents: previewAgents });
      if (path === `/api/workspaces/${workspace.id}/agents/support-assistant`)
        return reply({ agent: previewAgents[0] });
      if (path === `/api/workspaces/${workspace.id}/agents/support-assistant/versions`)
        return reply({
          versions: [
            {
              id: "preview-release-1",
              workspace_id: workspace.id,
              agent_id: "support-assistant",
              release_number: 1,
              created_by: "preview-owner",
              created_at: date,
              snapshot: { ...previewAgents[0], draft_version: 1 },
            },
          ],
        });
      if (path === `/api/workspaces/${workspace.id}`) return reply({ workspace });
      return reply({ error: { message: "Unavailable in visual preview" } }, 404);
    };
    setReady(true);
    return () => {
      window.fetch = originalFetch;
    };
  }, []);

  return (
    <div
      style={{ "--console-offset": "28px" } as React.CSSProperties}
      onClickCapture={(event) => {
        const link = (event.target as HTMLElement).closest("a");
        if (!link) return;
        const url = new URL(link.href);
        const prefix = `/workspaces/${workspace.id}/`;
        if (
          url.origin === window.location.origin &&
          url.pathname === `/workspaces/${workspace.id}`
        ) {
          event.preventDefault();
          event.stopPropagation();
          router.push("/preview/agents");
          return;
        }
        if (url.origin === window.location.origin && url.pathname.startsWith(prefix)) {
          event.preventDefault();
          event.stopPropagation();
          const destination = url.pathname.slice(prefix.length);
          if (destination === "integrations") {
            router.push(`/preview/integrations${url.search}`);
          } else if (
            /^(overview|inbox|knowledge|memory|settings|analytics|workflows|leads|campaigns|voice|audit|notifications|developer|eval|agents)(\/|$)/.test(
              destination,
            )
          )
            router.push(`/preview/${destination}${url.search}`);
        }
      }}
    >
      <div className="flex items-center gap-4 overflow-x-auto whitespace-nowrap border-b border-orange-200 bg-orange-50 px-4 py-1.5 text-[11px]">
        <span className="font-semibold">
          Local visual preview · Sample data · Actions are not executed
        </span>
        <Link className="text-heat-100 underline" href="/preview/inbox">
          Inbox
        </Link>
        <Link className="text-heat-100 underline" href="/preview/knowledge">
          Knowledge
        </Link>
        <Link className="text-heat-100 underline" href="/preview/memory">
          Memory
        </Link>
        <Link className="text-heat-100 underline" href="/preview/settings">
          Settings
        </Link>
        <Link className="text-heat-100 underline" href="/preview/agents">
          Agents
        </Link>
        <Link className="text-heat-100 underline" href="/preview/analytics">
          Analytics
        </Link>
        <Link className="text-heat-100 underline" href="/preview/workflows">
          Workflows
        </Link>
        <Link className="text-heat-100 underline" href="/preview/leads">
          Leads
        </Link>
        <Link className="text-heat-100 underline" href="/preview/campaigns">
          Campaigns
        </Link>
        <Link className="text-heat-100 underline" href="/preview/integrations">
          Integrations
        </Link>
        <Link className="text-heat-100 underline" href="/preview/voice/inbound">
          Voice
        </Link>
        <Link className="text-heat-100 underline" href="/preview/audit">
          Audit
        </Link>
        <Link className="text-heat-100 underline" href="/preview/notifications">
          Notifications
        </Link>
        <Link className="text-heat-100 underline" href="/preview/developer">
          Developer
        </Link>
        <Link className="text-heat-100 underline" href="/preview/agents/support-assistant/eval">
          Evaluation
        </Link>
        {view[0] === "memory" && (
          <span>Enter any subject key, e.g. customer:123, then Load facts.</span>
        )}
      </div>
      <AppShell
        workspaceId={workspace.id}
        workspaceName={workspace.name}
        userEmail="quickstart@gmail.com"
        workspaces={[workspace]}
        isPreview={true}
      >
        {!ready ? (
          <p>Loading sample data…</p>
        ) : view[0] === "inbox" ? (
          <div className="flex flex-1 min-h-0 min-w-0 overflow-hidden bg-white">
            <InboxSidebar workspaceId={workspace.id} isPreview />
            <div
              className={`${view[1] ? "flex" : "hidden md:flex"} flex-1 min-w-0 min-h-0 flex-col overflow-hidden`}
            >
              {view[1] ? (
                <>
                  {view[2] === "transcript" ? (
                    <TranscriptView workspaceId={workspace.id} conversationId={view[1]} />
                  ) : (
                    <ConversationThread
                      key={view[1]}
                      workspaceId={workspace.id}
                      conversationId={view[1]}
                      userId="preview-owner"
                      agentName="Demo Support Agent"
                    />
                  )}
                </>
              ) : (
                <EmptyInboxState />
              )}
            </div>
          </div>
        ) : view[0] === "eval" || (view[0] === "agents" && view[2] === "eval") ? (
          <EvaluationPreviewView view={view} />
        ) : view[0] === "agents" ? (
          !view[1] ? (
            <AgentList
              workspaceId={workspace.id}
              workspaceName={workspace.name}
              initialAgents={previewAgents}
            />
          ) : view[1] === "new" ? (
            <CreateAgentForm workspaceId={workspace.id} isPreview />
          ) : view[1] === "support-assistant" ? (
            <AgentEditor key={view[1]} workspaceId={workspace.id} initialAgent={previewAgents[0]} />
          ) : (
            <p role="alert">This agent is unavailable in the sample preview.</p>
          )
        ) : view[0] === "audit" ? (
          <AuditList workspaceId={workspace.id} initialSelectedEntryId={view[1]} isPreview={true} />
        ) : view[0] === "notifications" ? (
          <NotificationCenter workspaceId={workspace.id} isPreview={true} />
        ) : view[0] === "developer" ? (
          <DeveloperPreviewView viewSegments={view} />
        ) : view[0] === "integrations" ? (
          <DeveloperPreviewView viewSegments={["developer"]} />
        ) : view[0] === "voice" ? (
          <VoicePreviewView view={view} />
        ) : view[0] === "campaigns" ? (
          <CampaignPreviewView view={view} />
        ) : view[0] === "leads" ? (
          <LeadsPage
            workspaceId={workspace.id}
            workspaceSlug={workspace.slug}
            isSampleData={true}
          />
        ) : view[0] === "workflows" ? (
          <WorkflowPreviewView view={view} />
        ) : view[0] === "knowledge" ? (
          view[1] ? (
            <SourceDetails key={view[1]} workspaceId={workspace.id} sourceId={view[1]} isPreview />
          ) : (
            <KnowledgeSourceList workspaceId={workspace.id} />
          )
        ) : view[0] === "memory" ? (
          <MemoryFacts workspaceId={workspace.id} />
        ) : view[0] === "analytics" ? (
          <AnalyticsDashboard dataSource={createFixtureDataSource()} isSampleDataBadge={true} />
        ) : view[0] === "settings" ? (
          <WorkspaceSettings
            workspace={workspace}
            currentUser={{ id: "preview-owner", email: "alex@example.com", role: "owner" }}
            permissions={{
              canUpdateWorkspace: true,
              canDeleteWorkspace: true,
              canInvite: true,
              canUpdateRole: true,
              canRemoveMember: true,
              canManageSecrets: true,
              canManagePublishableKeys: true,
              canManageCustomTools: true,
            }}
          />
        ) : (
          <p role="alert">This page is unavailable in the sample preview.</p>
        )}
      </AppShell>
    </div>
  );
}
