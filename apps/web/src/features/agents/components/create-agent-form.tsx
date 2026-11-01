"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, ArrowRight, Bot, Check, MessageSquare, Mic, Sparkles } from "lucide-react";
import { createAgent } from "../lib/client";

type Props = {
  workspaceId: string;
  isPreview?: boolean;
  embedded?: boolean;
  onCancel?: () => void;
};
type AgentDraft = {
  name: string;
  description: string;
  instructions: string;
  chatEnabled: boolean;
  voiceEnabled: boolean;
  environment: string;
  step: number;
};

const DEFAULT_INSTRUCTIONS =
  "You are a helpful, professional customer assistant for our business. Answer questions accurately based on company information and guide the user with clear next steps.";

export function CreateAgentForm({
  workspaceId,
  isPreview = false,
  embedded = false,
  onCancel,
}: Props) {
  const router = useRouter();
  const draftKey = `quickstart:agent-draft:${workspaceId}`;
  const basePath = isPreview ? "/preview/agents" : `/workspaces/${workspaceId}/agents`;
  const [draft, setDraft] = useState<AgentDraft>({
    name: "",
    description: "",
    instructions: DEFAULT_INSTRUCTIONS,
    chatEnabled: true,
    voiceEnabled: false,
    environment: "production",
    step: 1,
  });
  const [hydrated, setHydrated] = useState(false);
  const [hasSavedDraft, setHasSavedDraft] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    try {
      const saved = window.localStorage.getItem(draftKey);
      if (saved) {
        const parsed = JSON.parse(saved) as Partial<AgentDraft>;
        setDraft((current) => ({
          ...current,
          ...parsed,
          step: Math.min(3, Math.max(1, parsed.step ?? 1)),
        }));
        setHasSavedDraft(true);
      }
    } catch {
      window.localStorage.removeItem(draftKey);
    }
    setHydrated(true);
  }, [draftKey]);

  useEffect(() => {
    if (!hydrated) return;
    const timeout = window.setTimeout(() => {
      window.localStorage.setItem(draftKey, JSON.stringify(draft));
      setHasSavedDraft(true);
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [draft, draftKey, hydrated]);

  function update(patch: Partial<AgentDraft>) {
    setDraft((current) => ({ ...current, ...patch }));
    setError(null);
  }

  function continueStep() {
    if (draft.step === 1 && !draft.name.trim()) {
      setError("Give your agent a name before continuing.");
      return;
    }
    if (draft.step === 2 && !draft.instructions.trim()) {
      setError("Add instructions to guide your agent.");
      return;
    }
    update({ step: Math.min(3, draft.step + 1) });
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (!draft.name.trim()) {
      update({ step: 1 });
      setError("Give your agent a name before creating it.");
      return;
    }
    setLoading(true);
    setError(null);
    const response = await createAgent(workspaceId, {
      name: draft.name.trim(),
      description: draft.description.trim() || null,
      instructions: draft.instructions.trim(),
      environment: draft.environment,
      channels: { chat: draft.chatEnabled, voice: draft.voiceEnabled },
      model_settings: {
        model: "gpt-6-luna",
        temperature: 0.3,
        max_tokens: 4096,
        reasoning_effort: "low",
        verbosity: "medium",
      },
      tools: [],
    });
    setLoading(false);
    if (response.error) {
      setError(response.error.message);
      return;
    }
    if (response.agent) {
      window.localStorage.removeItem(draftKey);
      router.push(`${basePath}/${response.agent.id}`);
      router.refresh();
    }
  }

  const steps = ["Identity", "Instructions", "Channels"];

  return (
    <div className={embedded ? "w-full space-y-4" : "mx-auto w-full max-w-3xl space-y-6"}>
      {!embedded && (
        <Link
          href={basePath}
          className="inline-flex items-center gap-2 text-[13px] font-semibold text-neutral-500 transition-colors hover:text-accent-black"
        >
          <ArrowLeft className="h-4 w-4" /> Back to agents
        </Link>
      )}

      <section className={embedded ? "" : "overflow-hidden rounded-20 border border-border-faint bg-white shadow-sm"}>
        {!embedded && (
        <header className="flex items-center gap-4 border-b border-border-faint px-5 py-5 sm:px-8">
          <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-16 bg-heat-8 text-heat-100">
            <Bot className="h-6 w-6" />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-xl font-extrabold tracking-tight text-accent-black sm:text-2xl">
              Create an agent
            </h1>
            <p className="mt-1 text-[13px] text-neutral-500">
              A few focused steps to get your new assistant ready.
            </p>
          </div>
          <span
            aria-live="polite"
            className="hidden items-center gap-1.5 rounded-full bg-neutral-50 px-3 py-1.5 text-[11px] font-medium text-neutral-500 sm:inline-flex"
          >
            <Check className="h-3.5 w-3.5 text-emerald-600" />
            {hasSavedDraft ? "Draft saved" : "Saving draft"}
          </span>
        </header>
        )}

        <div className="border-b border-border-faint bg-neutral-50/70 px-5 py-4 sm:px-8">
          <ol aria-label="Agent setup progress" className="grid grid-cols-3 gap-2">
            {steps.map((label, index) => {
              const number = index + 1;
              const current = draft.step === number;
              const done = draft.step > number;
              return (
                <li key={label} className="min-w-0">
                  <button
                    type="button"
                    onClick={() => number < draft.step && update({ step: number })}
                    disabled={number > draft.step}
                    aria-current={current ? "step" : undefined}
                    className={`flex w-full items-center gap-2 rounded-10 px-2 py-2 text-left text-[12px] font-semibold transition-colors sm:px-3 ${current ? "bg-white text-heat-100 shadow-sm ring-1 ring-border-faint" : done ? "text-accent-black" : "text-neutral-400"}`}
                  >
                    <span
                      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px] ${current ? "bg-heat-100 text-white" : done ? "bg-emerald-100 text-emerald-700" : "bg-neutral-200 text-neutral-500"}`}
                    >
                      {done ? <Check className="h-3.5 w-3.5" /> : number}
                    </span>
                    <span className="truncate">{label}</span>
                  </button>
                </li>
              );
            })}
          </ol>
        </div>

        <form onSubmit={handleSubmit} className="p-5 sm:p-8">
          <div className="min-h-[300px]">
            {draft.step === 1 && (
              <div className="max-w-xl space-y-6">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-accent-black">
                    Give your agent an identity
                  </h2>
                  <p className="mt-1 text-[13px] text-neutral-500">
                    Choose a name and a short description your team will recognize.
                  </p>
                </div>
                <Field label="Agent name" required>
                  <input
                    autoFocus
                    value={draft.name}
                    onChange={(event) => update({ name: event.target.value })}
                    placeholder="e.g. Customer support assistant"
                    className={inputClass}
                  />
                </Field>
                <Field label="Description">
                  <input
                    value={draft.description}
                    onChange={(event) => update({ description: event.target.value })}
                    placeholder="What should this agent help with?"
                    className={inputClass}
                  />
                </Field>
              </div>
            )}
            {draft.step === 2 && (
              <div className="space-y-5">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-accent-black">
                    Set the direction
                  </h2>
                  <p className="mt-1 text-[13px] text-neutral-500">
                    Describe how the agent should respond and help your customers.
                  </p>
                </div>
                <Field label="System instructions" required>
                  <textarea
                    autoFocus
                    rows={9}
                    value={draft.instructions}
                    onChange={(event) => update({ instructions: event.target.value })}
                    className={`${inputClass} resize-y font-mono text-[13px] leading-relaxed`}
                  />
                </Field>
                <p className="text-[12px] text-neutral-500">
                  You can refine instructions, models, and tools later in the agent editor.
                </p>
              </div>
            )}
            {draft.step === 3 && (
              <div className="space-y-6">
                <div>
                  <h2 className="text-lg font-bold tracking-tight text-accent-black">
                    Choose where it works
                  </h2>
                  <p className="mt-1 text-[13px] text-neutral-500">
                    You can change these channels and environment later.
                  </p>
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  {[
                    {
                      key: "chatEnabled" as const,
                      title: "Website chat",
                      detail: "Widget and staff conversations",
                      Icon: MessageSquare,
                    },
                    {
                      key: "voiceEnabled" as const,
                      title: "Voice calls",
                      detail: "Inbound and outbound calls",
                      Icon: Mic,
                    },
                  ].map(({ key, title, detail, Icon }) => (
                    <label
                      key={key}
                      className={`flex cursor-pointer items-start gap-3 rounded-14 border p-4 transition-colors ${draft[key] ? "border-heat-40 bg-heat-4" : "border-border-faint hover:bg-neutral-50"}`}
                    >
                      <input
                        type="checkbox"
                        checked={draft[key]}
                        onChange={(event) => update({ [key]: event.target.checked })}
                        className="mt-1 h-4 w-4 accent-[#fa5d19]"
                      />
                      <Icon
                        className={`mt-0.5 h-5 w-5 ${draft[key] ? "text-heat-100" : "text-neutral-500"}`}
                      />
                      <span>
                        <span className="block text-[14px] font-bold text-accent-black">
                          {title}
                        </span>
                        <span className="mt-1 block text-[12px] text-neutral-500">{detail}</span>
                      </span>
                    </label>
                  ))}
                </div>
                <Field label="Target environment">
                  <select
                    value={draft.environment}
                    onChange={(event) => update({ environment: event.target.value })}
                    className={inputClass}
                  >
                    <option value="production">Production</option>
                    <option value="staging">Staging</option>
                    <option value="development">Development</option>
                  </select>
                </Field>
                <div className="rounded-14 border border-border-faint bg-neutral-50 p-4">
                  <p className="text-[13px] font-semibold text-accent-black">
                    Ready to create {draft.name || "your agent"}
                  </p>
                  <p className="mt-1 text-[12px] text-neutral-500">
                    Your setup draft is saved on this device as you work.
                  </p>
                </div>
              </div>
            )}
          </div>

          {error && (
            <div
              role="alert"
              className="mt-5 rounded-12 border border-red-200 bg-red-50 px-4 py-3 text-[13px] text-red-700"
            >
              {error}
            </div>
          )}

          <footer className="mt-7 flex flex-col-reverse gap-3 border-t border-border-faint pt-5 sm:flex-row sm:items-center sm:justify-between">
            <div className="flex items-center gap-3">
              {embedded && onCancel ? (
                <button
                  type="button"
                  onClick={onCancel}
                  className="rounded-10 px-4 py-2.5 text-[13px] font-semibold text-neutral-500 hover:bg-neutral-50 hover:text-accent-black"
                >
                  Cancel
                </button>
              ) : (
                <Link
                  href={basePath}
                  className="rounded-10 px-4 py-2.5 text-[13px] font-semibold text-neutral-500 hover:bg-neutral-50 hover:text-accent-black"
                >
                  Cancel
                </Link>
              )}
              <span className="text-[11px] text-neutral-400 sm:hidden">
                Draft saves on this device
              </span>
            </div>
            <div className="flex items-center justify-between gap-2 sm:justify-end">
              {draft.step > 1 && (
                <button
                  type="button"
                  onClick={() => update({ step: draft.step - 1 })}
                  className="rounded-10 border border-border-faint px-4 py-2.5 text-[13px] font-semibold text-neutral-700 hover:bg-neutral-50"
                >
                  Back
                </button>
              )}
              {draft.step < 3 ? (
                <button
                  type="button"
                  onClick={continueStep}
                  className="inline-flex items-center gap-2 rounded-10 bg-heat-100 px-5 py-2.5 text-[13px] font-bold text-white shadow-sm transition-colors hover:bg-[#e04f14]"
                >
                  Continue <ArrowRight className="h-4 w-4" />
                </button>
              ) : (
                <button
                  type="submit"
                  disabled={loading || !draft.name.trim()}
                  className="inline-flex items-center gap-2 rounded-10 bg-heat-100 px-5 py-2.5 text-[13px] font-bold text-white shadow-sm transition-colors hover:bg-[#e04f14] disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <Sparkles className="h-4 w-4" />
                  {loading ? "Creating agent…" : "Create agent"}
                </button>
              )}
            </div>
          </footer>
        </form>
      </section>
      {hasSavedDraft && (
        <button
          type="button"
          onClick={() => {
            window.localStorage.removeItem(draftKey);
            setDraft({
              name: "",
              description: "",
              instructions: DEFAULT_INSTRUCTIONS,
              chatEnabled: true,
              voiceEnabled: false,
              environment: "production",
              step: 1,
            });
            setHasSavedDraft(false);
          }}
          className="mx-auto block text-[12px] text-neutral-400 underline decoration-neutral-300 underline-offset-4 hover:text-neutral-600"
        >
          Discard saved draft
        </button>
      )}
    </div>
  );
}

const inputClass =
  "w-full rounded-12 border border-border-muted bg-white px-4 py-3 text-[14px] text-accent-black placeholder:text-neutral-400 shadow-sm outline-none transition focus:border-heat-100 focus:ring-4 focus:ring-heat-8";

function Field({
  children,
  label,
  required = false,
}: {
  children: React.ReactNode;
  label: string;
  required?: boolean;
}) {
  return (
    <label className="block space-y-2">
      <span className="block text-[13px] font-bold text-accent-black">
        {label}
        {required && <span className="ml-1 text-heat-100">*</span>}
      </span>
      {children}
    </label>
  );
}
