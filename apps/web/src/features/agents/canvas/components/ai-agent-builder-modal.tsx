"use client";

import { useEffect, useState } from "react";
import { AlertCircle, Check, Loader2, Sparkles, X } from "lucide-react";
import type { AgentAiEditProposal } from "@quickstart/contracts";

type Props = {
  isOpen: boolean;
  agentName: string;
  proposal: AgentAiEditProposal | null;
  isLoading: boolean;
  error: string | null;
  onClose: () => void;
  onReset: () => void;
  onGenerate: (prompt: string) => void;
  onApply: () => void;
};

const EXAMPLES = [
  "Add a knowledge-search step before answering questions and hand off when no answer is found.",
  "Create an appointment flow that collects name, email, and preferred time before booking.",
  "Make the agent more concise, friendly, and clear about what it can and cannot do.",
];

export function AiAgentBuilderModal({
  isOpen,
  agentName,
  proposal,
  isLoading,
  error,
  onClose,
  onReset,
  onGenerate,
  onApply,
}: Props) {
  const [prompt, setPrompt] = useState("");

  useEffect(() => {
    if (isOpen) setPrompt("");
  }, [isOpen]);

  if (!isOpen) return null;

  const validationErrors =
    proposal?.validation.issues.filter((issue) => issue.type === "error") ?? [];
  const canApply = Boolean(proposal?.validation.valid) && !isLoading;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="ai-agent-builder-title"
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#101828]/35 p-4 backdrop-blur-[1px]"
      onClick={(event) => {
        if (event.target === event.currentTarget && !isLoading) onClose();
      }}
    >
      <div className="flex max-h-[min(760px,calc(100dvh-32px))] w-full max-w-[620px] flex-col overflow-hidden rounded-xl border border-neutral-200 bg-white shadow-xl">
        <div className="flex items-start justify-between border-b border-neutral-200 px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-8 w-8 items-center justify-center rounded-lg border border-neutral-200 bg-neutral-50 text-neutral-600">
              <Sparkles className="h-4 w-4" />
            </div>
            <div>
              <h2
                id="ai-agent-builder-title"
                className="text-[15px] font-semibold text-neutral-900"
              >
                Improve {agentName} with AI
              </h2>
              <p className="mt-0.5 text-xs text-neutral-500">
                Describe the behavior you want. AI will prepare a validated draft for review.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            aria-label="Close AI editor"
            className="rounded-md p-1.5 text-neutral-400 transition-colors hover:bg-neutral-100 hover:text-neutral-700 disabled:opacity-40"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {!proposal && (
            <div className="space-y-4">
              <div>
                <label
                  htmlFor="ai-agent-builder-prompt"
                  className="text-xs font-medium text-neutral-700"
                >
                  What should change?
                </label>
                <textarea
                  id="ai-agent-builder-prompt"
                  autoFocus
                  rows={6}
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                  placeholder="Example: Add a friendly FAQ flow, use our knowledge base, and hand off unanswered questions to a human."
                  className="mt-2 w-full resize-y rounded-lg border border-neutral-300 px-3 py-2.5 text-sm text-neutral-900 outline-none transition-colors placeholder:text-neutral-400 focus:border-neutral-500 focus:ring-2 focus:ring-neutral-100"
                />
                <p className="mt-1.5 text-[11px] text-neutral-500">
                  AI can update instructions, add or connect workflow nodes, and configure safe
                  fallbacks.
                </p>
              </div>

              <div>
                <p className="mb-2 text-[11px] font-medium uppercase tracking-[0.04em] text-neutral-500">
                  Try an example
                </p>
                <div className="space-y-1.5">
                  {EXAMPLES.map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => setPrompt(example)}
                      className="block w-full rounded-md border border-neutral-200 px-3 py-2 text-left text-xs text-neutral-600 transition-colors hover:border-neutral-300 hover:bg-neutral-50"
                    >
                      {example}
                    </button>
                  ))}
                </div>
              </div>

              {error && (
                <div
                  role="alert"
                  className="flex gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700"
                >
                  <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </div>
          )}

          {isLoading && !proposal && (
            <div className="flex items-center justify-center gap-2 py-10 text-sm text-neutral-500">
              <Loader2 className="h-4 w-4 animate-spin" />
              Building and validating your draft…
            </div>
          )}

          {proposal && (
            <div className="space-y-4">
              <div className="rounded-lg border border-neutral-200 bg-neutral-50 px-3.5 py-3">
                <p className="text-[11px] font-medium uppercase tracking-[0.04em] text-neutral-500">
                  Proposal
                </p>
                <p className="mt-1 text-sm leading-relaxed text-neutral-800">{proposal.summary}</p>
              </div>

              <div>
                <p className="mb-2 text-xs font-medium text-neutral-700">Planned changes</p>
                <ul className="space-y-1.5">
                  {proposal.changes.map((change, index) => (
                    <li key={`${change}-${index}`} className="flex gap-2 text-xs text-neutral-600">
                      <Check className="mt-0.5 h-3.5 w-3.5 shrink-0 text-neutral-500" />
                      <span>{change}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  ["Nodes", proposal.graph.nodes.length],
                  ["Connections", proposal.graph.edges.length],
                  ["Warnings", proposal.validation.summary.warnings],
                ].map(([label, value]) => (
                  <div key={label} className="rounded-md border border-neutral-200 px-2 py-2">
                    <div className="text-sm font-semibold text-neutral-900">{value}</div>
                    <div className="text-[11px] text-neutral-500">{label}</div>
                  </div>
                ))}
              </div>

              {validationErrors.length > 0 && (
                <div
                  role="alert"
                  className="rounded-lg border border-red-200 bg-red-50 px-3 py-2.5 text-xs text-red-700"
                >
                  <p className="font-medium">
                    This draft needs attention before it can be applied:
                  </p>
                  <ul className="mt-1 list-disc space-y-0.5 pl-4">
                    {validationErrors.slice(0, 5).map((issue, index) => (
                      <li key={`${issue.code ?? issue.message}-${index}`}>{issue.message}</li>
                    ))}
                  </ul>
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex items-center justify-between border-t border-neutral-200 px-5 py-3">
          <button
            type="button"
            onClick={proposal ? onReset : onClose}
            disabled={isLoading}
            className="rounded-md px-3 py-2 text-xs font-medium text-neutral-600 transition-colors hover:bg-neutral-100 disabled:opacity-40"
          >
            {proposal ? "Start over" : "Cancel"}
          </button>
          {proposal ? (
            <button
              type="button"
              onClick={onApply}
              disabled={!canApply}
              className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <Check className="h-3.5 w-3.5" />
              Apply to draft
            </button>
          ) : (
            <button
              type="button"
              onClick={() => onGenerate(prompt)}
              disabled={isLoading || prompt.trim().length < 4}
              className="inline-flex items-center gap-1.5 rounded-md bg-neutral-900 px-3.5 py-2 text-xs font-medium text-white transition-colors hover:bg-neutral-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {isLoading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <Sparkles className="h-3.5 w-3.5" />
              )}
              Build draft
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
