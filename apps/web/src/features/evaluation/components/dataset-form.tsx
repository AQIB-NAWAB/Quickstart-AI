"use client";

import { ArrowLeft, Database, Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EvaluationApiClient } from "../lib/api-repository";
import type { EvaluationDataset } from "../lib/types";

interface DatasetFormProps {
  workspaceId: string;
  isPreview?: boolean;
  agents?: Array<{ id: string; name: string }>;
  onSubmit?: (data: {
    name: string;
    description?: string;
    tags?: string[];
  }) => Promise<EvaluationDataset | null>;
}

export function DatasetForm({
  workspaceId,
  isPreview = false,
  agents = [],
  onSubmit,
}: DatasetFormProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [tags, setTags] = useState("");
  const [agentId, setAgentId] = useState(agents[0]?.id ?? "");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const basePath = isPreview ? "/preview/eval" : `/workspaces/${workspaceId}/eval`;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) {
      setError("Dataset name is required.");
      return;
    }

    setIsSubmitting(true);
    setError(null);

    const tagsArray = tags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      if (onSubmit) {
        const created = await onSubmit({
          name: name.trim(),
          description: description.trim() || undefined,
          tags: tagsArray,
        });
        if (created) {
          router.push(`${basePath}/datasets/${created.id}`);
          return;
        }
      } else {
        if (!agentId) {
          setError("Select an agent before creating a dataset.");
          setIsSubmitting(false);
          return;
        }
        const res = await EvaluationApiClient.createDataset(workspaceId, {
          agentId,
          name: name.trim(),
          description: description.trim() || undefined,
          tags: tagsArray,
        });

        if (!res.ok) {
          setError(res.error);
          setIsSubmitting(false);
          return;
        }

        router.push(`${basePath}/datasets/${res.data.dataset.id}`);
        return;
      }

      router.push(`${basePath}/datasets`);
    } catch (err: unknown) {
      setError((err instanceof Error ? err.message : null) || "Failed to create dataset.");
      setIsSubmitting(false);
    }
  };

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3 border-b border-[#EAECF0] pb-4">
        <Link
          href={`${basePath}/datasets`}
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#EAECF0] text-[#71717A] hover:bg-[#F8F9FB] hover:text-[#18181B] transition-colors"
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold tracking-tight text-[#18181B]">
            Create Evaluation Dataset
          </h1>
          <p className="text-xs text-[#71717A] mt-0.5">
            Create a benchmark dataset to evaluate agent versions against expected outputs and
            tools.
          </p>
        </div>
      </div>

      <div className="rounded-xl border border-[#EAECF0] bg-white p-6 shadow-xs">
        <form onSubmit={handleSubmit} className="space-y-4">
          {error && (
            <div className="rounded-lg bg-[#FEF3F2] border border-[#FEE4E2] p-3 text-xs text-[#B42318]">
              {error}
            </div>
          )}

          {!isPreview && (
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[#18181B]">
                Agent <span className="text-[#FF571A]">*</span>
              </label>
              {agents.length > 0 ? (
                <select
                  value={agentId}
                  onChange={(e) => setAgentId(e.target.value)}
                  className="w-full rounded-lg border border-[#DCE1E8] bg-white px-3 py-2 text-xs text-[#18181B] focus:border-[#FF571A] focus:outline-none"
                >
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              ) : (
                <p className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800">
                  Create an agent first, then create an evaluation dataset for it.
                </p>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#18181B]">
              Dataset Name <span className="text-[#FF571A]">*</span>
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Customer Support Benchmarks, Checkout Flow Tests"
              className="w-full rounded-lg border border-[#DCE1E8] bg-white px-3 py-2 text-xs text-[#18181B] focus:border-[#FF571A] focus:outline-none"
              required
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#18181B]">Description (optional)</label>
            <textarea
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="What domain, capabilities, or edge cases does this dataset test?"
              className="w-full rounded-lg border border-[#DCE1E8] bg-white px-3 py-2 text-xs text-[#18181B] focus:border-[#FF571A] focus:outline-none"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-xs font-semibold text-[#18181B]">
              Tags (optional, comma-separated)
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="support, refunds, edge-cases"
              className="w-full rounded-lg border border-[#DCE1E8] bg-white px-3 py-2 text-xs text-[#18181B] focus:border-[#FF571A] focus:outline-none"
            />
          </div>

          <div className="rounded-xl border border-[#EAECF0] bg-[#F8F9FB] p-3.5 text-xs text-[#71717A] space-y-1">
            <div className="font-semibold text-[#18181B] flex items-center gap-1.5">
              <Database className="h-4 w-4 text-[#FF571A]" />
              <span>Immutable Snapshot Revisions</span>
            </div>
            <p className="text-[11px] text-[#71717A] leading-relaxed">
              Datasets start at revision 1. Any subsequent edits or batch imports increment the
              revision number and create frozen snapshots during evaluation runs so historical test
              metrics remain 100% reproducible.
            </p>
          </div>

          <div className="flex items-center justify-end gap-3 pt-3 border-t border-[#EAECF0]">
            <Link
              href={`${basePath}/datasets`}
              className="rounded-lg border border-[#EAECF0] bg-white px-4 py-2 text-xs font-semibold text-[#18181B] hover:bg-[#F8F9FB] transition-colors"
            >
              Cancel
            </Link>
            <button
              type="submit"
              disabled={isSubmitting}
              className="flex items-center gap-1.5 rounded-lg bg-[#FF571A] px-4 py-2 text-xs font-semibold text-white shadow-xs hover:bg-[#E0460D] transition-colors disabled:opacity-50"
            >
              <Plus className="h-3.5 w-3.5" />
              <span>{isSubmitting ? "Creating..." : "Create Dataset"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
