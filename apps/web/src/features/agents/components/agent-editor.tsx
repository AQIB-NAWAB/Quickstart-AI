"use client";

import { useEffect, useState, useMemo } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import type { Agent, AgentToolDefinition, AgentVersion } from "../lib/types";
import { normalizeAgentConfiguration } from "@quickstart/contracts";
import {
  getAgent,
  listVersions,
  publishAgent,
  rollbackAgent,
  scheduleRelease,
  setCanary,
  updateAgent,
} from "../lib/client";
import { listCustomTools } from "@/features/settings/lib/client";
import type { CustomToolItem } from "@/features/settings/lib/types";
import { EditorHeader } from "./editor-header";
import { EditorTabs, type EditorTabKey } from "./editor-tabs";
import { InstructionsTab } from "./instructions-tab";
import { ModelTab } from "./model-tab";
import { AgentToolsPanel } from "./agent-tools-panel";
import { IdentityChannelsTab } from "./identity-channels-tab";
import { ReleasesTab } from "./releases-tab";
import { TestAgentPanel } from "./test-agent-panel";
import { ConflictBanner } from "./conflict-banner";
import { PublishModal } from "./publish-modal";
import { DiffModal } from "./diff-modal";
import { AgentOutlineIcon } from "@/components/brand/agent-outline-icon";
import { PoliciesTab } from "./policies-tab";
import { AnalyticsDashboard } from "@/features/analytics/components/analytics-dashboard";

type Props = {
  workspaceId: string;
  initialAgent: Agent;
  canManageCustomTools?: boolean;
};

export function AgentEditor({ workspaceId, initialAgent, canManageCustomTools = true }: Props) {
  const router = useRouter();
  const [agent, setAgent] = useState<Agent>(initialAgent);
  const [activeTab, setActiveTab] = useState<EditorTabKey>("instructions");

  // Form state
  const [name, setName] = useState(initialAgent.name);
  const [description, setDescription] = useState(initialAgent.description || "");
  const [instructions, setInstructions] = useState(initialAgent.instructions);
  const [environment, setEnvironment] = useState(initialAgent.environment);
  const [chatEnabled, setChatEnabled] = useState(initialAgent.channels.chat);
  const [voiceEnabled, setVoiceEnabled] = useState(initialAgent.channels.voice);
  const [ttsVoiceId, setTtsVoiceId] = useState(
    initialAgent.voice?.tts_voice_id || "default",
  );
  const [voiceLanguage, setVoiceLanguage] = useState(initialAgent.voice?.language || "en-US");

  const modelSettings = initialAgent.model_settings || {};
  const [model, setModel] = useState((modelSettings.model as string) || "gpt-6-luna");
  const [temperature, setTemperature] = useState(
    typeof modelSettings.temperature === "number" ? modelSettings.temperature : 0.3,
  );
  const [maxTokens, setMaxTokens] = useState(
    typeof modelSettings.max_tokens === "number" ? modelSettings.max_tokens : 4096,
  );
  const [reasoningEffort, setReasoningEffort] = useState(
    typeof modelSettings.reasoning_effort === "string" ? modelSettings.reasoning_effort : "auto",
  );
  const [verbosity, setVerbosity] = useState(
    typeof modelSettings.verbosity === "string" ? modelSettings.verbosity : "medium",
  );

  const [attachedTools, setAttachedTools] = useState<AgentToolDefinition[]>(
    initialAgent.tools || [],
  );
  const [configuration, setConfiguration] = useState(() =>
    normalizeAgentConfiguration(initialAgent.configuration),
  );
  const [customTools, setCustomTools] = useState<CustomToolItem[]>([]);
  const [customToolsLoading, setCustomToolsLoading] = useState(false);
  const [customToolsError, setCustomToolsError] = useState<string | null>(null);

  // Status & Conflict Handling
  const [isSaving, setIsSaving] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [isConflict, setIsConflict] = useState(false);

  // Versions state
  const [versions, setVersions] = useState<AgentVersion[]>([]);
  const [versionsLoading, setVersionsLoading] = useState(false);
  const [versionsError, setVersionsError] = useState<string | null>(null);

  // Modals & Panels
  const [isPublishOpen, setIsPublishOpen] = useState(false);
  const [isTestModalOpen, setIsTestModalOpen] = useState(false);
  const [diffModalState, setDiffModalState] = useState<{
    isOpen: boolean;
    leftId: string;
    rightId: string;
    leftTitle: string;
    rightTitle: string;
  }>({
    isOpen: false,
    leftId: "",
    rightId: "",
    leftTitle: "",
    rightTitle: "",
  });

  // Calculate dirty state
  const isDirty = useMemo(() => {
    return (
      name.trim() !== agent.name.trim() ||
      description.trim() !== (agent.description || "").trim() ||
      instructions.trim() !== agent.instructions.trim() ||
      environment !== agent.environment ||
      chatEnabled !== agent.channels.chat ||
      voiceEnabled !== agent.channels.voice ||
      ttsVoiceId !== (agent.voice?.tts_voice_id || "default") ||
      voiceLanguage !== (agent.voice?.language || "en-US") ||
      model !== ((agent.model_settings?.model as string) || "gpt-6-luna") ||
      temperature !==
        (typeof agent.model_settings?.temperature === "number"
          ? agent.model_settings.temperature
          : 0.3) ||
      maxTokens !==
        (typeof agent.model_settings?.max_tokens === "number"
          ? agent.model_settings.max_tokens
          : 4096) ||
      reasoningEffort !== ((agent.model_settings?.reasoning_effort as string) || "auto") ||
      verbosity !== ((agent.model_settings?.verbosity as string) || "medium") ||
      JSON.stringify(attachedTools) !== JSON.stringify(agent.tools || []) ||
      JSON.stringify(configuration) !==
        JSON.stringify(normalizeAgentConfiguration(agent.configuration))
    );
  }, [
    name,
    description,
    instructions,
    environment,
    chatEnabled,
    voiceEnabled,
    ttsVoiceId,
    voiceLanguage,
    model,
    temperature,
    maxTokens,
    reasoningEffort,
    verbosity,
    attachedTools,
    agent,
    configuration,
  ]);

  // Window unload warning if dirty
  useEffect(() => {
    function handleBeforeUnload(e: BeforeUnloadEvent) {
      if (isDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    }
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [isDirty]);

  // Fetch versions
  const fetchVersions = () => {
    setVersionsLoading(true);
    setVersionsError(null);
    listVersions(workspaceId, agent.id)
      .then((res) => {
        setVersionsLoading(false);
        if (res.error) {
          setVersionsError(res.error.message);
        } else if (res.versions) {
          setVersions(res.versions);
        }
      })
      .catch((err) => {
        setVersionsLoading(false);
        setVersionsError(err instanceof Error ? err.message : "Failed to load versions");
      });
  };

  useEffect(() => {
    if (activeTab === "releases") {
      fetchVersions();
    }
  }, [activeTab, workspaceId, agent.id]);

  // Fetch workspace custom tools when the tools tab opens
  useEffect(() => {
    if (activeTab !== "tools") return;
    let cancelled = false;
    setCustomToolsLoading(true);
    setCustomToolsError(null);
    listCustomTools(workspaceId).then((res) => {
      if (cancelled) return;
      setCustomToolsLoading(false);
      if (res.tools) {
        setCustomTools(res.tools);
      } else {
        setCustomToolsError(res.error?.message || "Failed to load custom tools.");
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeTab, workspaceId]);

  // Save handler with Optimistic Concurrency Control
  async function handleSave() {
    if (isSaving || !isDirty) return;
    setIsSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    try {
      const res = await updateAgent(workspaceId, agent.id, {
        name: name.trim(),
        description: description.trim() || null,
        instructions: instructions.trim(),
        environment,
        channels: { chat: chatEnabled, voice: voiceEnabled },
        model_settings: {
          ...agent.model_settings,
          model,
          model_id: model,
          profile: model.startsWith("claude")
            ? "anthropic"
            : model.includes("/") || /llama|mixtral|gemma|gpt-oss/i.test(model)
              ? "groq"
              : "openai",
          temperature,
          max_tokens: maxTokens,
          ...(reasoningEffort !== "auto" ? { reasoning_effort: reasoningEffort } : {}),
          verbosity,
        },
        tools: attachedTools,
        voice: {
          voice_mode: agent.voice?.voice_mode || "cascade",
          language: voiceLanguage,
          tts_voice_id: ttsVoiceId,
          max_response_chars: agent.voice?.max_response_chars ?? 500,
          turn_detection_profile_id: agent.voice?.turn_detection_profile_id || "eager",
          recording_enabled: agent.voice?.recording_enabled ?? true,
        },
        configuration,
        expected_version: agent.version,
      });

      setIsSaving(false);
      if (res.isConflict) {
        setIsConflict(true);
      } else if (res.error) {
        setSaveError(res.error.message);
      } else if (res.agent) {
        setAgent(res.agent);
        setIsConflict(false);
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 3000);
      }
    } catch (err: unknown) {
      setIsSaving(false);
      setSaveError(err instanceof Error ? err.message : "Save failed");
    }
  }

  // Reload latest server version on 409
  async function handleReloadServerVersion() {
    setIsSaving(true);
    try {
      const res = await getAgent(workspaceId, agent.id);
      setIsSaving(false);
      if (res.agent) {
        const a = res.agent;
        setAgent(a);
        setName(a.name);
        setDescription(a.description || "");
        setInstructions(a.instructions);
        setEnvironment(a.environment);
        setChatEnabled(a.channels.chat);
        setVoiceEnabled(a.channels.voice);
        setTtsVoiceId(a.voice?.tts_voice_id || "default");
        setVoiceLanguage(a.voice?.language || "en-US");
        const m = a.model_settings || {};
        setModel((m.model as string) || "gpt-6-luna");
        setTemperature(typeof m.temperature === "number" ? m.temperature : 0.3);
        setMaxTokens(typeof m.max_tokens === "number" ? m.max_tokens : 1024);
        setReasoningEffort(typeof m.reasoning_effort === "string" ? m.reasoning_effort : "auto");
        setVerbosity(typeof m.verbosity === "string" ? m.verbosity : "medium");
        setAttachedTools(a.tools || []);
        setConfiguration(normalizeAgentConfiguration(a.configuration));
        setIsConflict(false);
        setSaveError(null);
      }
    } catch {
      setIsSaving(false);
    }
  }

  // Refresh only the concurrency token, preserving this browser's draft fields.
  async function handleKeepLocalDraft() {
    setIsSaving(true);
    try {
      const res = await getAgent(workspaceId, agent.id);
      if (res.agent) {
        setAgent(res.agent);
        setIsConflict(false);
        setSaveError(null);
      }
    } finally {
      setIsSaving(false);
    }
  }

  // Publish release
  async function handlePublishConfirm(input: {
    approval?: { approved: boolean; note?: string };
    completedChecklist: string[];
  }) {
    const res = await publishAgent(workspaceId, agent.id, agent.version, {
      approval: input.approval,
      completedChecklist: input.completedChecklist,
    });
    if (res.error) {
      throw new Error(res.error.message);
    }
    if (res.agent) {
      setAgent(res.agent);
      fetchVersions();
      router.refresh();
    }
  }

  // Rollback to earlier release
  async function handleRollbackConfirm(versionId: string) {
    const res = await rollbackAgent(workspaceId, agent.id, versionId);
    if (res.error) {
      throw new Error(res.error.message);
    }
    if (res.agent) {
      setAgent(res.agent);
      fetchVersions();
      router.refresh();
    }
  }

  async function handleCanaryChange(versionId: string | null, percentage: number) {
    const res = await setCanary(workspaceId, agent.id, versionId, percentage);
    if (res.error) throw new Error(res.error.message);
    if (res.agent) setAgent(res.agent);
  }

  async function handleScheduleRelease(versionId: string, publishAt: string) {
    const res = await scheduleRelease(workspaceId, agent.id, versionId, publishAt);
    if (res.error) throw new Error(res.error.message);
    if (res.agent) setAgent(res.agent);
  }

  // Tool attachment toggle
  function toggleTool(tool: AgentToolDefinition) {
    setAttachedTools((prev) => {
      const exists = prev.some((t) => t.name === tool.name);
      if (exists) {
        return prev.filter((t) => t.name !== tool.name);
      }
      return [...prev, tool];
    });
  }

  function updateTool(tool: AgentToolDefinition) {
    setAttachedTools((prev) => prev.map((item) => (item.name === tool.name ? tool : item)));
  }

  // Derive latest release number for label display if available
  const currentLiveRelease = versions.find((v) => v.id === agent.production_version_id);
  const liveReleaseNumber = currentLiveRelease?.release_number;

  return (
    <div className="space-y-6 w-full pb-10">
      {/* Header matching 2.png */}
      <EditorHeader
        agent={agent}
        releaseNumber={liveReleaseNumber}
        workspaceId={workspaceId}
        isDirty={isDirty}
        isSaving={isSaving}
        saveSuccess={saveSuccess}
        saveError={saveError}
        onSave={handleSave}
        onPublish={() => setIsPublishOpen(true)}
        onOpenTest={() => setIsTestModalOpen(true)}
        onOpenReleases={() => setActiveTab("releases")}
      />

      {/* 409 Conflict Banner */}
      {isConflict && (
        <ConflictBanner
          currentVersion={agent.version}
          onReload={handleReloadServerVersion}
          onKeepLocalDraft={handleKeepLocalDraft}
        />
      )}

      {/* Save Error Banner */}
      {saveError && !isConflict && (
        <div className="p-3.5 rounded-[8px] bg-red-50 border border-red-200 text-red-700 text-[13px] flex items-center justify-between">
          <span>{saveError}</span>
          <button
            type="button"
            onClick={() => setSaveError(null)}
            className="text-[12px] underline hover:no-underline ml-4"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Tabs navigation matching 2.png-8.png */}
      <EditorTabs
        activeTab={activeTab}
        onTabChange={setActiveTab}
        workspaceId={workspaceId}
        agentId={agent.id}
      />

      {/* Tab Panels: Full content width without inline testing panel */}
      <div className="pt-2">
        {activeTab === "instructions" && (
          <InstructionsTab
            instructions={instructions}
            onChangeInstructions={setInstructions}
            isDirty={isDirty}
            version={agent.version}
          />
        )}

        {activeTab === "model" && (
          <ModelTab
            workspaceId={workspaceId}
            model={model}
            onChangeModel={setModel}
            temperature={temperature}
            onChangeTemperature={setTemperature}
            maxTokens={maxTokens}
            onChangeMaxTokens={setMaxTokens}
            reasoningEffort={reasoningEffort}
            onChangeReasoningEffort={setReasoningEffort}
            verbosity={verbosity}
            onChangeVerbosity={setVerbosity}
            isDirty={isDirty}
          />
        )}

        {activeTab === "tools" && (
          <AgentToolsPanel
            workspaceId={workspaceId}
            canManageCustomTools={canManageCustomTools}
            attachedTools={attachedTools}
            onToggle={toggleTool}
            onUpdate={updateTool}
            customTools={customTools}
            customToolsLoading={customToolsLoading}
            customToolsError={customToolsError}
            onCustomToolsChange={setCustomTools}
          />
        )}

        {activeTab === "policies" && (
          <PoliciesTab
            workspaceId={workspaceId}
            configuration={configuration}
            onChange={setConfiguration}
          />
        )}

        {activeTab === "identity" && (
          <IdentityChannelsTab
            workspaceId={workspaceId}
            name={name}
            onChangeName={setName}
            description={description}
            onChangeDescription={setDescription}
            environment={environment}
            onChangeEnvironment={setEnvironment}
            chatEnabled={chatEnabled}
            onChangeChatEnabled={setChatEnabled}
            voiceEnabled={voiceEnabled}
            onChangeVoiceEnabled={setVoiceEnabled}
            selectedVoiceId={ttsVoiceId}
            onChangeVoice={({ voiceId, language }) => {
              setTtsVoiceId(voiceId);
              setVoiceLanguage(language);
            }}
            isDirty={isDirty}
          />
        )}

        {activeTab === "releases" && (
          <ReleasesTab
            agent={agent}
            versions={versions}
            loading={versionsLoading}
            error={versionsError}
            onRefresh={fetchVersions}
            onRollback={handleRollbackConfirm}
            onSetCanary={handleCanaryChange}
            onScheduleRelease={handleScheduleRelease}
            onOpenDiff={(leftId, rightId, leftTitle, rightTitle) => {
              setDiffModalState({
                isOpen: true,
                leftId,
                rightId,
                leftTitle,
                rightTitle,
              });
            }}
          />
        )}

        {activeTab === "observability" && (
          <AnalyticsDashboard workspaceId={workspaceId} agentId={agent.id} />
        )}

        {activeTab === "evaluation" && (
          <div className="rounded-[12px] border border-[#DCE1E8] bg-white p-12 text-center shadow-sm space-y-3">
            <div className="w-12 h-12 rounded-[10px] bg-[#F8F9FB] border border-[#DCE1E8] text-[#202125] mx-auto flex items-center justify-center">
              <AgentOutlineIcon className="w-6 h-6 text-[#202125]" />
            </div>
            <h3 className="text-[20px] font-semibold text-[#202125]">Agent evaluation</h3>
            <p className="text-[14px] text-[#667085] max-w-md mx-auto leading-relaxed">
              Build saved test datasets, run regression suites against immutable releases, and
              compare pass rates, latency, and tool behavior.
            </p>
            <Link
              href={`/workspaces/${workspaceId}/agents/${agent.id}/eval`}
              className="inline-flex items-center justify-center rounded-[6px] bg-[#FF571A] px-4 py-2.5 text-[14px] font-medium text-white hover:bg-[#E04B14] transition-colors"
            >
              Open evaluation workspace
            </Link>
          </div>
        )}
      </div>

      {/* Shared Centered Test Agent Modal (9.png) */}
      {isTestModalOpen && (
        <TestAgentPanel
          agent={agent}
          workspaceId={workspaceId}
          releaseNumber={liveReleaseNumber}
          isOpen={true}
          onClose={() => setIsTestModalOpen(false)}
        />
      )}

      {/* Publish Modal */}
      <PublishModal
        isOpen={isPublishOpen}
        onClose={() => setIsPublishOpen(false)}
        onConfirm={handlePublishConfirm}
        agent={agent}
        hasUnsavedChanges={isDirty}
      />

      {/* Diff Modal */}
      <DiffModal
        isOpen={diffModalState.isOpen}
        onClose={() =>
          setDiffModalState((prev) => ({
            ...prev,
            isOpen: false,
          }))
        }
        workspaceId={workspaceId}
        agentId={agent.id}
        leftId={diffModalState.leftId}
        rightId={diffModalState.rightId}
        leftTitle={diffModalState.leftTitle}
        rightTitle={diffModalState.rightTitle}
      />
    </div>
  );
}
