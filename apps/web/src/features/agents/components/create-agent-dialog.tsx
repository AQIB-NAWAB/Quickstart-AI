"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  ChevronDown,
  FileText,
  MessageSquare,
  Mic,
  MoreHorizontal,
  X,
} from "lucide-react";
import { createAgent } from "../lib/client";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  workspaceId: string;
  workspaceName: string;
};

type DraftState = {
  step: 1 | 2 | 3;
  name: string;
  description: string;
  instructions: string;
  chatEnabled: boolean;
  voiceEnabled: boolean;
  environment: string;
};

const DEFAULT_INSTRUCTIONS =
  "You are a helpful, professional customer assistant for our business. Answer questions accurately based on company information and guide the user with clear next steps.";

export function CreateAgentDialog({
  isOpen,
  onClose,
  workspaceId,
  workspaceName,
}: Props) {
  const router = useRouter();
  const draftStorageKey = `quickstart:agent-draft:${workspaceId}`;

  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [instructions, setInstructions] = useState(DEFAULT_INSTRUCTIONS);
  const [chatEnabled, setChatEnabled] = useState(true);
  const [voiceEnabled, setVoiceEnabled] = useState(false);
  const [environment, setEnvironment] = useState("production");

  const [nameError, setNameError] = useState<string | null>(null);
  const [instructionsError, setInstructionsError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [isSavedLocally, setIsSavedLocally] = useState(false);
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmDiscardOpen, setConfirmDiscardOpen] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);
  const nameInputRef = useRef<HTMLInputElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  // Restore local draft on mount
  useEffect(() => {
    if (!isOpen) { setHydratedKey(null); return; }
    setIsSavedLocally(false);
    try {
      const saved = window.localStorage.getItem(draftStorageKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<DraftState>;
        if (typeof parsed.name === "string") setName(parsed.name);
        if (typeof parsed.description === "string") setDescription(parsed.description);
        if (typeof parsed.instructions === "string") setInstructions(parsed.instructions);
        if (typeof parsed.chatEnabled === "boolean") setChatEnabled(parsed.chatEnabled);
        if (typeof parsed.voiceEnabled === "boolean") setVoiceEnabled(parsed.voiceEnabled);
        if (typeof parsed.environment === "string" && ["production", "staging", "development"].includes(parsed.environment)) setEnvironment(parsed.environment);
        if (parsed.step && [1, 2, 3].includes(parsed.step)) setStep(parsed.step as 1 | 2 | 3);
        setIsSavedLocally(true);
      }
    } catch {
      // Keep the in-memory setup usable if browser storage cannot be read.
    } finally {
      setHydratedKey(draftStorageKey);
    }
  }, [isOpen, draftStorageKey]);

  // Persist local draft on state change
  useEffect(() => {
    if (!isOpen || hydratedKey !== draftStorageKey) return;
    try {
      const payload: DraftState = {
        step,
        name,
        description,
        instructions,
        chatEnabled,
        voiceEnabled,
        environment,
      };
      window.localStorage.setItem(draftStorageKey, JSON.stringify(payload));
      setIsSavedLocally(true);
    } catch {
      setIsSavedLocally(false);
    }
  }, [isOpen, hydratedKey, draftStorageKey, step, name, description, instructions, chatEnabled, voiceEnabled, environment]);

  // Keep keyboard focus inside the setup dialog and restore its trigger on close.
  useEffect(() => {
    if (!isOpen) return;
    const trigger = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const trap = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const controls = Array.from(dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], [tabindex="0"]',
      ) ?? []).filter((element) => element.getClientRects().length > 0);
      const first = controls[0];
      const last = controls[controls.length - 1];
      if (!first || !last) return;
      if (event.shiftKey && (document.activeElement === first || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || !dialogRef.current?.contains(document.activeElement))) {
        event.preventDefault(); first.focus();
      }
    };
    document.addEventListener("keydown", trap);
    return () => {
      document.body.style.overflow = overflow;
      document.removeEventListener("keydown", trap);
      trigger?.focus();
    };
  }, [isOpen]);

  useEffect(() => {
    if (!isOpen) return;
    const frame = requestAnimationFrame(() => {
      if (step === 1) nameInputRef.current?.focus();
      else dialogRef.current?.querySelector<HTMLElement>(step === 2 ? "#agent-instructions" : "#agent-env")?.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [isOpen, step]);

  // Outside click for menu & Escape key handling
  useEffect(() => {
    if (!isOpen) return;
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        if (confirmDiscardOpen) {
          setConfirmDiscardOpen(false);
        } else if (menuOpen) {
          setMenuOpen(false);
        } else {
          onClose();
        }
      }
    };
    const handleClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("mousedown", handleClick);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("mousedown", handleClick);
    };
  }, [isOpen, menuOpen, confirmDiscardOpen, onClose]);

  if (!isOpen) return null;

  function discardDraft() {
    try {
      window.localStorage.removeItem(draftStorageKey);
    } catch {
      // Ignore
    }
    setName("");
    setDescription("");
    setInstructions(DEFAULT_INSTRUCTIONS);
    setChatEnabled(true);
    setVoiceEnabled(false);
    setEnvironment("production");
    setStep(1);
    setIsSavedLocally(false);
    setConfirmDiscardOpen(false);
    setMenuOpen(false);
  }

  function handleContinueStep1() {
    const trimmed = name.trim();
    if (!trimmed) {
      setNameError("Give your agent a name before continuing.");
      nameInputRef.current?.focus();
      return;
    }
    setNameError(null);
    setStep(2);
  }

  function handleContinueStep2() {
    const trimmed = instructions.trim();
    if (!trimmed) {
      setInstructionsError("Add instructions to guide your agent.");
      return;
    }
    setInstructionsError(null);
    setStep(3);
  }

  async function handleCreateAgent() {
    const trimmedName = name.trim();
    const trimmedInstructions = instructions.trim();

    if (!trimmedName) {
      setStep(1);
      setNameError("Give your agent a name before continuing.");
      return;
    }

    if (!trimmedInstructions) {
      setStep(2);
      setInstructionsError("Add instructions to guide your agent.");
      return;
    }

    setIsSubmitting(true);
    setSubmitError(null);

    const res = await createAgent(workspaceId, {
      name: trimmedName,
      description: description.trim() || null,
      instructions: trimmedInstructions,
      environment,
      channels: {
        chat: chatEnabled,
        voice: voiceEnabled,
      },
      model_settings: {
        model: "gpt-6-luna",
        model_id: "gpt-6-luna",
        profile: "openai",
        temperature: 0.3,
        max_tokens: 4096,
        reasoning_effort: "low",
        verbosity: "medium",
      },
      voice: voiceEnabled
        ? {
            voice_mode: "cascade",
            language: "en-US",
            tts_voice_id: "default",
            max_response_chars: 500,
            turn_detection_profile_id: "default",
            recording_enabled: true,
          }
        : undefined,
      configuration: {
        knowledge: {
          enabled: true,
          source_ids: [],
          search_method: "hybrid",
          max_results: 5,
          failure_policy: "open",
        },
        memory: {
          enabled: true,
          subject_key_template: "anon:{visitor_id}",
          max_facts: 20,
          failure_policy: "open",
          allow_runtime_writes: true,
        },
        guardrails: {
          enabled: true,
          block_prompt_injection: true,
          redact_pii: true,
          blocked_topics: [],
          allowed_topics: [],
          violation_action: "refuse",
          custom_instructions: "",
        },
        release: {
          require_approval: false,
          required_checklist: [],
          auto_rollback_error_rate_pct: null,
        },
        observability: {
          trace_retention_days: 7,
          capture_inputs: true,
          capture_outputs: true,
        },
      },
      tools: [],
    });

    setIsSubmitting(false);

    if (res.error) {
      setSubmitError(res.error.message || "Failed to create agent");
      return;
    }

    if (res.agent) {
      try {
        window.localStorage.removeItem(draftStorageKey);
      } catch {
        // Ignore
      }
      onClose();
      router.push(`/workspaces/${workspaceId}/agents/${res.agent.id}`);
    }
  }

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="create-agent-dialog-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-[#101828]/40 animate-in fade-in duration-150"
    >
      <div
        ref={dialogRef}
        className="agent-create-dialog w-full max-w-[640px] max-h-[calc(100dvh-48px)] bg-white rounded-[12px] border border-[#DCE1E8] shadow-2xl flex flex-col overflow-hidden animate-in zoom-in-95 duration-150"
      >
        {/* Header matching 10.png / 11.png / 12.png */}
        <div className="px-7 py-5 flex items-start justify-between border-b border-[#EDF0F2] shrink-0 bg-white">
          <div>
            <h1 id="create-agent-dialog-title" className="text-[20px] font-semibold text-[#202125]">
              Create agent
            </h1>
            <p className="text-[13px] text-[#667085] mt-0.5">{workspaceName}</p>
          </div>

          <div className="flex items-center gap-1.5">
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-label="More options"
                aria-expanded={menuOpen}
                className="p-1.5 text-[#667085] hover:text-[#202125] hover:bg-[#F8F9FB] rounded-[6px] transition-colors"
              >
                <MoreHorizontal className="w-5 h-5" />
              </button>

              {menuOpen && (
                <div className="absolute right-0 top-[calc(100%+4px)] z-30 w-48 rounded-[8px] border border-[#DCE1E8] bg-white py-1 shadow-lg">
                  <button
                    type="button"
                    onClick={() => {
                      setMenuOpen(false);
                      setConfirmDiscardOpen(true);
                    }}
                    className="w-full text-left px-3.5 py-2 text-[13px] font-medium text-[#B42318] hover:bg-red-50 transition-colors"
                  >
                    Discard setup draft
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={onClose}
              aria-label="Close dialog"
              className="p-1.5 text-[#667085] hover:text-[#202125] hover:bg-[#F8F9FB] rounded-[6px] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Stepper Indicator */}
        <div className="px-7 pt-6 pb-2 bg-white shrink-0">
          <div className="flex items-center justify-between max-w-[500px] mx-auto text-[14px]">
            {/* Step 1 */}
            <button
              type="button"
              onClick={() => setStep(1)}
              className="flex items-center gap-2.5 group cursor-pointer"
            >
              {step > 1 ? (
                <span className="w-8 h-8 rounded-full border border-[#202125] text-[#202125] flex items-center justify-center text-[12px] font-bold">
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                </span>
              ) : (
                <span className="w-8 h-8 rounded-full bg-[#FF571A] text-white flex items-center justify-center text-[13px] font-semibold">
                  1
                </span>
              )}
              <span className={`font-medium ${step === 1 ? "text-[#202125] font-semibold" : "text-[#344054]"}`}>
                Identity
              </span>
            </button>

            <div className="flex-1 max-w-[64px] h-[1px] bg-[#DCE1E8] mx-2" />

            {/* Step 2 */}
            <button
              type="button"
              onClick={() => {
                if (step >= 2) setStep(2);
              }}
              disabled={step < 2}
              className="flex items-center gap-2.5 group disabled:cursor-not-allowed"
            >
              {step > 2 ? (
                <span className="w-8 h-8 rounded-full border border-[#202125] text-[#202125] flex items-center justify-center text-[12px] font-bold">
                  <Check className="w-3.5 h-3.5 stroke-[2.5]" />
                </span>
              ) : step === 2 ? (
                <span className="w-8 h-8 rounded-full bg-[#FF571A] text-white flex items-center justify-center text-[13px] font-semibold">
                  2
                </span>
              ) : (
                <span className="w-8 h-8 rounded-full border border-[#DCE1E8] text-[#7A808A] flex items-center justify-center text-[13px] font-medium">
                  2
                </span>
              )}
              <span
                className={`font-medium ${
                  step === 2
                    ? "text-[#202125] font-semibold"
                    : step > 2
                    ? "text-[#344054]"
                    : "text-[#7A808A]"
                }`}
              >
                Instructions
              </span>
            </button>

            <div className="flex-1 max-w-[64px] h-[1px] bg-[#DCE1E8] mx-2" />

            {/* Step 3 */}
            <button
              type="button"
              onClick={() => {
                if (step === 3) setStep(3);
              }}
              disabled={step !== 3}
              className="flex items-center gap-2.5 group disabled:cursor-not-allowed"
            >
              {step === 3 ? (
                <span className="w-8 h-8 rounded-full bg-[#FF571A] text-white flex items-center justify-center text-[13px] font-semibold">
                  3
                </span>
              ) : (
                <span className="w-8 h-8 rounded-full border border-[#DCE1E8] text-[#7A808A] flex items-center justify-center text-[13px] font-medium">
                  3
                </span>
              )}
              <span className={`font-medium ${step === 3 ? "text-[#202125] font-semibold" : "text-[#7A808A]"}`}>
                Channels
              </span>
            </button>
          </div>
        </div>

        {/* Modal Body (Scrollable if viewport is short) */}
        <div className="px-7 py-6 sm:px-10 overflow-y-auto flex-1 space-y-6">
          {submitError && (
            <div className="p-3 text-[13px] text-[#B42318] bg-red-50 border border-red-200 rounded-[8px]">
              {submitError}
            </div>
          )}

          {/* STEP 1: IDENTITY (10.png) */}
          {step === 1 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-[22px] font-semibold text-[#202125] tracking-tight">
                  Give your agent a name
                </h2>
                <p className="mt-1 text-[14px] text-[#667085]">
                  Choose a name your team will recognize.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="agent-name" className="block text-[14px] font-medium text-[#202125]">
                    Agent name <span className="text-[#FF571A]">*</span>
                  </label>
                  <input
                    ref={nameInputRef}
                    id="agent-name"
                    aria-invalid={Boolean(nameError)}
                    aria-describedby={nameError ? "agent-name-error" : undefined}
                    type="text"
                    value={name}
                    onChange={(e) => {
                      setName(e.target.value);
                      if (nameError) setNameError(null);
                    }}
                    placeholder="e.g. Customer support"
                    className={`mt-1.5 w-full px-3.5 py-2.5 text-[14px] text-[#202125] bg-white border rounded-[8px] focus:outline-none focus:ring-1 transition-colors ${
                      nameError
                        ? "border-[#B42318] focus:border-[#B42318] focus:ring-[#B42318]"
                        : "border-[#DCE1E8] focus:border-[#FF571A] focus:ring-[#FF571A]"
                    }`}
                  />
                  {nameError ? (
                    <p id="agent-name-error" role="alert" className="mt-1.5 text-[12px] text-[#B42318]">{nameError}</p>
                  ) : (
                    <p className="mt-1.5 text-[12px] text-[#667085]">You can change this later.</p>
                  )}
                </div>

                <div>
                  <div className="flex items-center justify-between">
                    <label htmlFor="agent-description" className="block text-[14px] font-medium text-[#202125]">
                      Description
                    </label>
                    <span className="text-[12px] text-[#667085]">Optional</span>
                  </div>
                  <textarea
                    id="agent-description"
                    rows={3}
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    placeholder="What does this agent help with?"
                    className="mt-1.5 w-full px-3.5 py-2.5 text-[14px] text-[#202125] bg-white border border-[#DCE1E8] rounded-[8px] focus:outline-none focus:border-[#FF571A] focus:ring-1 focus:ring-[#FF571A] resize-none leading-relaxed transition-colors"
                  />
                </div>
              </div>
            </div>
          )}

          {/* STEP 2: INSTRUCTIONS (11.png) */}
          {step === 2 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-[22px] font-semibold text-[#202125] tracking-tight">
                  How should your agent help?
                </h2>
                <p className="mt-1 text-[14px] text-[#667085]">
                  Describe its role, tone, and the boundaries it should follow.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <label htmlFor="agent-instructions" className="block text-[14px] font-medium text-[#202125]">
                    System instructions <span className="text-[#FF571A]">*</span>
                  </label>
                  <textarea
                    id="agent-instructions"
                    aria-invalid={Boolean(instructionsError)}
                    aria-describedby={instructionsError ? "agent-instructions-error" : undefined}
                    rows={8}
                    value={instructions}
                    onChange={(e) => {
                      setInstructions(e.target.value);
                      if (instructionsError) setInstructionsError(null);
                    }}
                    placeholder="Describe how your agent should act..."
                    className={`mt-1.5 w-full p-4 text-[14px] text-[#202125] bg-white border rounded-[8px] focus:outline-none focus:ring-1 resize-none leading-relaxed transition-colors ${
                      instructionsError
                        ? "border-[#B42318] focus:border-[#B42318] focus:ring-[#B42318]"
                        : "border-[#DCE1E8] focus:border-[#FF571A] focus:ring-[#FF571A]"
                    }`}
                  />
                  {instructionsError && (
                    <p id="agent-instructions-error" role="alert" className="mt-1.5 text-[12px] text-[#B42318]">{instructionsError}</p>
                  )}
                </div>

                <div className="space-y-1.5">
                  <h3 className="text-[14px] font-semibold text-[#202125]">A useful starting point</h3>
                  <p className="text-[13px] text-[#667085] leading-relaxed">
                    Be specific about what to answer, how to sound, and when to ask a teammate for help.
                  </p>
                  <p className="text-[12px] text-[#7A808A] pt-0.5">
                    You can refine these instructions in the agent editor.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* STEP 3: CHANNELS (12.png) */}
          {step === 3 && (
            <div className="space-y-6">
              <div>
                <h2 className="text-[22px] font-semibold text-[#202125] tracking-tight">
                  Choose where your agent works
                </h2>
                <p className="mt-1 text-[14px] text-[#667085]">
                  Select the channels you want to use. You can change these later.
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <span className="block text-[14px] font-medium text-[#202125] mb-2">Channels</span>
                  <div className="border border-[#DCE1E8] rounded-[8px] divide-y divide-[#EDF0F2] overflow-hidden">
                    {/* Website Chat */}
                    <label
                      className={`p-4 flex items-center justify-between cursor-pointer transition-colors ${
                        chatEnabled ? "bg-[#FFF6F2]" : "hover:bg-[#F8F9FB]"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <MessageSquare className="w-5 h-5 text-[#202125]" />
                        <div>
                          <span className="block text-[14px] font-semibold text-[#202125]">Website chat</span>
                          <span className="block text-[13px] text-[#667085]">Widget and staff conversations</span>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={chatEnabled}
                        onChange={(e) => setChatEnabled(e.target.checked)}
                        className="w-5 h-5 accent-[#FF571A] rounded text-[#FF571A] border-[#DCE1E8] focus:ring-[#FF571A] cursor-pointer"
                      />
                    </label>

                    {/* Voice Calls */}
                    <label
                      className={`p-4 flex items-center justify-between cursor-pointer transition-colors ${
                        voiceEnabled ? "bg-[#FFF6F2]" : "hover:bg-[#F8F9FB]"
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        <Mic className="w-5 h-5 text-[#202125]" />
                        <div>
                          <span className="block text-[14px] font-semibold text-[#202125]">Voice calls</span>
                          <span className="block text-[13px] text-[#667085]">Inbound and outbound calls</span>
                        </div>
                      </div>
                      <input
                        type="checkbox"
                        checked={voiceEnabled}
                        onChange={(e) => setVoiceEnabled(e.target.checked)}
                        className="w-5 h-5 accent-[#FF571A] rounded text-[#FF571A] border-[#DCE1E8] focus:ring-[#FF571A] cursor-pointer"
                      />
                    </label>
                  </div>
                </div>

                <div>
                  <label htmlFor="agent-env" className="block text-[14px] font-medium text-[#202125] mb-1.5">
                    Environment
                  </label>
                  <div className="relative">
                    <select
                      id="agent-env"
                      value={environment}
                      onChange={(e) => setEnvironment(e.target.value)}
                      className="w-full appearance-none px-3.5 py-2.5 text-[14px] text-[#202125] bg-white border border-[#DCE1E8] rounded-[8px] focus:outline-none focus:border-[#FF571A] focus:ring-1 focus:ring-[#FF571A] pr-10 transition-colors"
                    >
                      <option value="production">Production</option>
                      <option value="staging">Staging</option>
                      <option value="development">Development</option>
                    </select>
                    <ChevronDown className="w-4 h-4 text-[#667085] absolute right-3 top-1/2 -translate-y-1/2 pointer-events-none" />
                  </div>
                  <p className="mt-1.5 text-[12px] text-[#667085]">
                    An environment label. This doesn&apos;t publish your agent.
                  </p>
                </div>

                <div className="p-4 bg-[#F8F9FB] border border-[#DCE1E8] rounded-[8px] flex items-start gap-3">
                  <FileText className="w-4 h-4 text-[#667085] shrink-0 mt-0.5" />
                  <div>
                    <h3 className="text-[14px] font-semibold text-[#202125]">Create as a draft</h3>
                    <p className="text-[13px] text-[#667085] mt-0.5 leading-relaxed">
                      <strong className="text-[#202125]">{name || "Your agent"}</strong> will open in the editor. Publish it when you&apos;re ready to make it live.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* Progress saved on this device */}
          {isSavedLocally && (
            <div className="flex items-center gap-1.5 text-[13px] text-[#667085] pt-1">
              <Check className="w-3.5 h-3.5 text-[#667085]" />
              <span>Progress saved on this device</span>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-7 py-4 bg-white border-t border-[#EDF0F2] flex items-center justify-between shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="text-[14px] font-medium text-[#475467] hover:text-[#202125] transition-colors"
          >
            Save &amp; close
          </button>

          <div className="flex items-center gap-2.5">
            {step > 1 && (
              <button
                type="button"
                onClick={() => setStep((s) => (s === 3 ? 2 : 1))}
                className="px-4 py-2 text-[14px] font-medium text-[#202125] bg-white border border-[#DCE1E8] rounded-[8px] hover:bg-[#F8F9FB] transition-colors"
              >
                Back
              </button>
            )}

            {step === 1 && (
              <button
                type="button"
                onClick={handleContinueStep1}
                className="inline-flex items-center gap-1.5 px-5 py-2 text-[14px] font-semibold text-white bg-[#FF571A] hover:bg-[#E04810] rounded-[8px] shadow-sm transition-colors"
              >
                Continue
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {step === 2 && (
              <button
                type="button"
                onClick={handleContinueStep2}
                className="inline-flex items-center gap-1.5 px-5 py-2 text-[14px] font-semibold text-white bg-[#FF571A] hover:bg-[#E04810] rounded-[8px] shadow-sm transition-colors"
              >
                Continue
                <ArrowRight className="w-4 h-4" />
              </button>
            )}

            {step === 3 && (
              <button
                type="button"
                onClick={() => void handleCreateAgent()}
                disabled={isSubmitting}
                className="inline-flex items-center gap-1.5 px-5 py-2 text-[14px] font-semibold text-white bg-[#FF571A] hover:bg-[#E04810] rounded-[8px] shadow-sm transition-colors disabled:opacity-50"
              >
                {isSubmitting ? "Creating agent..." : "Create agent"}
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Discard Confirmation Modal */}
      {confirmDiscardOpen && (
        <div className="fixed inset-0 z-60 flex items-center justify-center p-4 bg-[#101828]/40">
          <div className="bg-white rounded-[12px] border border-[#DCE1E8] p-6 max-w-sm w-full space-y-4 shadow-xl">
            <h3 className="text-[17px] font-semibold text-[#202125]">Discard setup draft?</h3>
            <p className="text-[13px] text-[#667085] leading-relaxed">
              This will clear the entered details on this device and reset the wizard.
            </p>
            <div className="flex items-center justify-end gap-2.5 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDiscardOpen(false)}
                className="px-3.5 py-1.5 text-[13px] font-medium text-[#202125] bg-white border border-[#DCE1E8] rounded-[8px] hover:bg-[#F8F9FB]"
              >
                Keep editing
              </button>
              <button
                type="button"
                onClick={discardDraft}
                className="px-3.5 py-1.5 text-[13px] font-semibold text-white bg-[#B42318] hover:bg-[#912018] rounded-[8px]"
              >
                Discard
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
