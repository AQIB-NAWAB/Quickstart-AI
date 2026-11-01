"use client";

import {
  AlertCircle,
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronRight,
  Cpu,
  Download,
  Edit2,
  FileText,
  Filter,
  Play,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { EvaluationApiClient } from "../lib/api-repository";
import type {
  EvaluationCase,
  EvaluationDataset,
  ExpectedToolCall,
  FixtureResponse,
} from "../lib/types";
import { DatasetImportDialog } from "./dataset-import-dialog";
import { StartEvaluationDialog } from "./start-evaluation-dialog";

interface DatasetEditorProps {
  workspaceId: string;
  dataset: EvaluationDataset;
  initialCases: EvaluationCase[];
  isPreview?: boolean;
}

export function DatasetEditor({
  workspaceId,
  dataset: initialDataset,
  initialCases,
  isPreview = false,
}: DatasetEditorProps) {
  const router = useRouter();
  const [dataset, setDataset] = useState<EvaluationDataset>(initialDataset);
  const [cases, setCases] = useState<EvaluationCase[]>(initialCases);
  const [expandedCaseIds, setExpandedCaseIds] = useState<Set<string>>(
    new Set(initialCases.length > 0 ? [initialCases[0].id] : []),
  );
  const [search, setSearch] = useState("");
  const [selectedTag, setSelectedTag] = useState<string>("all");
  const [isImportOpen, setIsImportOpen] = useState(false);
  const [isStartEvalOpen, setIsStartEvalOpen] = useState(false);

  // Case Modal state (for Add or Edit)
  const [modalOpen, setModalOpen] = useState(false);
  const [editingCase, setEditingCase] = useState<EvaluationCase | null>(null);
  const [formName, setFormName] = useState("");
  const [formInput, setFormInput] = useState("");
  const [formExpectedOutput, setFormExpectedOutput] = useState("");
  const [formTags, setFormTags] = useState("");
  const [formTools, setFormTools] = useState<ExpectedToolCall[]>([]);
  const [formFixtures, setFormFixtures] = useState<FixtureResponse[]>([]);
  const [isSaving, setIsSaving] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  const basePath = isPreview ? "/preview/eval" : `/workspaces/${workspaceId}/eval`;

  // Aggregate tags
  const allTags = Array.from(new Set(cases.flatMap((c) => c.tags || []))).filter(Boolean);

  const filteredCases = cases.filter((c) => {
    const matchesSearch =
      c.name.toLowerCase().includes(search.toLowerCase()) ||
      c.input.toLowerCase().includes(search.toLowerCase()) ||
      c.expectedOutput.toLowerCase().includes(search.toLowerCase());
    const matchesTag = selectedTag === "all" || (c.tags && c.tags.includes(selectedTag));
    return matchesSearch && matchesTag;
  });

  const toggleExpand = (id: string) => {
    setExpandedCaseIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleOpenAddModal = () => {
    setEditingCase(null);
    setFormName(`Test Case ${cases.length + 1}`);
    setFormInput("");
    setFormExpectedOutput("");
    setFormTags("");
    setFormTools([]);
    setFormFixtures([]);
    setModalError(null);
    setModalOpen(true);
  };

  const handleOpenEditModal = (c: EvaluationCase) => {
    setEditingCase(c);
    setFormName(c.name);
    setFormInput(c.input);
    setFormExpectedOutput(c.expectedOutput);
    setFormTags(c.tags ? c.tags.join(", ") : "");
    setFormTools(c.expectedTools || []);
    setFormFixtures(c.fixtureResponses || []);
    setModalError(null);
    setModalOpen(true);
  };

  const handleSaveCaseSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!formInput.trim()) {
      setModalError("User query input is required.");
      return;
    }

    setIsSaving(true);
    setModalError(null);

    const tagsArray = formTags
      .split(",")
      .map((t) => t.trim())
      .filter(Boolean);

    try {
      if (editingCase) {
        const res = await EvaluationApiClient.updateCase(workspaceId, dataset.id, editingCase.id, {
          name: formName.trim() || editingCase.name,
          input: formInput.trim(),
          expectedOutput: formExpectedOutput.trim(),
          expectedTools: formTools,
          fixtureResponses: formFixtures,
          tags: tagsArray,
          expectedRecordVersion: editingCase.recordVersion,
        });

        if (!res.ok) {
          setModalError(res.error);
          setIsSaving(false);
          return;
        }

        setCases((prev) => prev.map((c) => (c.id === editingCase.id ? res.data.case : c)));
      } else {
        const res = await EvaluationApiClient.createCase(workspaceId, dataset.id, {
          name: formName.trim() || `Case ${cases.length + 1}`,
          input: formInput.trim(),
          expectedOutput: formExpectedOutput.trim(),
          expectedTools: formTools,
          fixtureResponses: formFixtures,
          tags: tagsArray,
        });

        if (!res.ok) {
          setModalError(res.error);
          setIsSaving(false);
          return;
        }

        setCases((prev) => [res.data.case, ...prev]);
        setDataset((prev) => ({
          ...prev,
          caseCount: prev.caseCount + 1,
          revision: prev.revision + 1,
        }));
        setExpandedCaseIds((prev) => new Set(prev).add(res.data.case.id));
      }

      setIsSaving(false);
      setModalOpen(false);
    } catch (err) {
      setModalError(err instanceof Error ? err.message : "Failed to save test case");
      setIsSaving(false);
    }
  };

  const handleDeleteCase = async (caseId: string) => {
    if (!confirm("Are you sure you want to delete this test case?")) return;

    try {
      const res = await EvaluationApiClient.deleteCase(workspaceId, dataset.id, caseId);
      if (res.ok) {
        setCases((prev) => prev.filter((c) => c.id !== caseId));
        setDataset((prev) => ({
          ...prev,
          caseCount: Math.max(0, prev.caseCount - 1),
          revision: prev.revision + 1,
        }));
      }
    } catch {
      // Ignored
    }
  };

  const handleExportCsv = () => {
    const exportUrl = `/api/workspaces/${encodeURIComponent(workspaceId)}/eval/datasets/${encodeURIComponent(dataset.id)}/export`;
    window.open(exportUrl, "_blank");
  };

  return (
    <div className="space-y-6">
      {/* Top Header matching Image 2 */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 border-b border-[#EAECF0] pb-4">
        <div className="flex items-center gap-3">
          <Link
            href={`${basePath}/datasets`}
            className="flex h-8 w-8 items-center justify-center rounded-lg border border-[#EAECF0] text-[#71717A] hover:bg-[#F8F9FB] hover:text-[#18181B] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
          </Link>

          <div>
            <div className="flex items-center gap-2.5">
              <h1 className="text-xl font-bold tracking-tight text-[#18181B]">{dataset.name}</h1>
              <span className="rounded-full bg-[#F1F3F5] px-2.5 py-0.5 font-mono text-[11px] font-semibold text-[#18181B]">
                rev {dataset.revision} · {dataset.caseCount} cases
              </span>
            </div>
            <p className="text-xs text-[#71717A] mt-0.5">
              {dataset.description ||
                "Manage test cases, expected outputs, and mock fixture responses."}
            </p>
          </div>
        </div>

        {/* Action Buttons */}
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={handleExportCsv}
            className="flex items-center gap-1.5 rounded-lg border border-[#EAECF0] bg-white px-3 py-1.5 text-xs font-semibold text-[#18181B] hover:bg-[#F8F9FB] transition-colors"
          >
            <Download className="h-3.5 w-3.5 text-[#71717A]" />
            <span>Export CSV</span>
          </button>

          <button
            type="button"
            onClick={() => setIsImportOpen(true)}
            className="flex items-center gap-1.5 rounded-lg border border-[#EAECF0] bg-white px-3 py-1.5 text-xs font-semibold text-[#18181B] hover:bg-[#F8F9FB] transition-colors"
          >
            <Upload className="h-3.5 w-3.5 text-[#71717A]" />
            <span>Import CSV</span>
          </button>

          <button
            type="button"
            onClick={() => setIsStartEvalOpen(true)}
            disabled={cases.length === 0}
            className="flex items-center gap-1.5 rounded-lg border border-[#EAECF0] bg-white px-3 py-1.5 text-xs font-semibold text-[#18181B] hover:bg-[#F8F9FB] transition-colors disabled:opacity-50"
          >
            <Play className="h-3.5 w-3.5 text-[#FF571A] fill-[#FF571A]" />
            <span>Run Evaluation</span>
          </button>

          <button
            type="button"
            onClick={handleOpenAddModal}
            className="flex items-center gap-1.5 rounded-lg bg-[#FF571A] px-3.5 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[#E0460D] transition-colors"
          >
            <Plus className="h-3.5 w-3.5" />
            <span>Add Test Case</span>
          </button>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="relative w-full max-w-sm">
          <Search className="absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[#71717A]" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search test cases by query or expected output..."
            className="w-full rounded-lg border border-[#DCE1E8] bg-white pl-9 pr-3 py-2 text-xs text-[#18181B] focus:border-[#FF571A] focus:outline-none"
          />
        </div>

        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5 text-xs text-[#71717A]">
            <Filter className="h-3.5 w-3.5" />
            <span>Tag:</span>
          </div>
          <select
            value={selectedTag}
            onChange={(e) => setSelectedTag(e.target.value)}
            className="rounded-lg border border-[#DCE1E8] bg-white px-3 py-1.5 text-xs font-medium text-[#18181B] focus:border-[#FF571A] focus:outline-none"
          >
            <option value="all">All Tags ({allTags.length})</option>
            {allTags.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
        </div>
      </div>

      {/* Cases List with Expandable Rows matching Image 2 */}
      <div className="space-y-3">
        {filteredCases.length === 0 ? (
          <div className="rounded-xl border border-dashed border-[#DCE1E8] bg-[#F8F9FB] p-8 text-center text-xs text-[#71717A]">
            No test cases found. Click "Add Test Case" or "Import CSV" to populate this dataset.
          </div>
        ) : (
          filteredCases.map((c, index) => {
            const isExpanded = expandedCaseIds.has(c.id);
            return (
              <div
                key={c.id}
                className="rounded-xl border border-[#EAECF0] bg-white transition-all shadow-xs overflow-hidden"
              >
                {/* Collapsed summary row */}
                <div
                  onClick={() => toggleExpand(c.id)}
                  className="flex items-center justify-between p-3.5 cursor-pointer hover:bg-[#F8F9FB]/60 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <button
                      type="button"
                      aria-label="Expand test case"
                      className="text-[#71717A] hover:text-[#18181B] transition-colors"
                    >
                      {isExpanded ? (
                        <ChevronDown className="h-4 w-4 text-[#FF571A]" />
                      ) : (
                        <ChevronRight className="h-4 w-4" />
                      )}
                    </button>

                    <div className="flex items-center gap-2 min-w-0">
                      <span className="font-mono text-[11px] font-semibold text-[#71717A]">
                        #{index + 1}
                      </span>
                      <span className="font-bold text-xs text-[#18181B] truncate">{c.name}</span>
                      {c.tags && c.tags.length > 0 && (
                        <div className="hidden sm:flex items-center gap-1">
                          {c.tags.slice(0, 2).map((t) => (
                            <span
                              key={t}
                              className="rounded bg-[#F8F9FB] border border-[#EAECF0] px-1.5 py-0.5 text-[10px] text-[#71717A]"
                            >
                              {t}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    {c.expectedTools && c.expectedTools.length > 0 && (
                      <span className="inline-flex items-center gap-1 rounded-full bg-[#FF571A]/10 px-2 py-0.5 font-mono text-[10px] font-semibold text-[#FF571A]">
                        <Cpu className="h-3 w-3" />
                        <span>{c.expectedTools.length} tool</span>
                      </span>
                    )}

                    <div className="flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        onClick={() => handleOpenEditModal(c)}
                        aria-label="Edit test case"
                        className="rounded p-1 text-[#71717A] hover:bg-[#F8F9FB] hover:text-[#18181B] transition-colors"
                      >
                        <Edit2 className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => handleDeleteCase(c.id)}
                        aria-label="Delete test case"
                        className="rounded p-1 text-[#71717A] hover:bg-[#FEF3F2] hover:text-[#B42318] transition-colors"
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  </div>
                </div>

                {/* Expanded Details matching Image 2 */}
                {isExpanded && (
                  <div className="border-t border-[#EAECF0] bg-[#F8F9FB]/40 p-4 space-y-3">
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      {/* Panel 1: User Message / Input */}
                      <div className="rounded-xl border border-[#EAECF0] bg-white p-3 space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#18181B]">
                          <FileText className="h-3.5 w-3.5 text-[#FF571A]" />
                          <span>User Query / Input</span>
                        </div>
                        <div className="rounded-lg bg-[#F8F9FB] p-2.5 font-mono text-xs text-[#18181B] leading-relaxed select-all">
                          {c.input}
                        </div>
                      </div>

                      {/* Panel 2: Expected Output */}
                      <div className="rounded-xl border border-[#EAECF0] bg-white p-3 space-y-1.5">
                        <div className="flex items-center gap-1.5 text-xs font-semibold text-[#18181B]">
                          <Check className="h-3.5 w-3.5 text-[#027A48]" />
                          <span>Expected Response</span>
                        </div>
                        <div className="rounded-lg bg-[#F8F9FB] p-2.5 text-xs text-[#18181B] leading-relaxed">
                          {c.expectedOutput || (
                            <span className="text-[#A1A1AA]">No expected text constraint</span>
                          )}
                        </div>
                      </div>
                    </div>

                    {/* Panel 3: Expected Tool Invocations & Mock Fixtures */}
                    <div className="rounded-xl border border-[#EAECF0] bg-white p-3 space-y-2">
                      <div className="flex items-center justify-between text-xs font-semibold text-[#18181B]">
                        <div className="flex items-center gap-1.5">
                          <Cpu className="h-3.5 w-3.5 text-[#FF571A]" />
                          <span>Expected Tool Invocations & Mock Fixtures</span>
                        </div>
                        <span className="text-[10px] text-[#71717A] font-normal">
                          Evaluated in isolated execution sandbox
                        </span>
                      </div>

                      {c.expectedTools && c.expectedTools.length > 0 ? (
                        <div className="space-y-2">
                          {c.expectedTools.map((t, tidx) => {
                            const fixture = c.fixtureResponses?.find((f) => f.toolName === t.name);
                            return (
                              <div
                                key={tidx}
                                className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 rounded-lg border border-[#EAECF0] bg-[#F8F9FB] p-2.5 text-xs"
                              >
                                <div className="space-y-1">
                                  <div className="flex items-center gap-2">
                                    <span className="font-mono font-bold text-[#FF571A]">
                                      {t.name}()
                                    </span>
                                    {t.order != null && (
                                      <span className="text-[10px] text-[#71717A]">
                                        (step {t.order})
                                      </span>
                                    )}
                                  </div>
                                  {t.arguments && (
                                    <pre className="text-[11px] font-mono text-[#71717A] bg-white px-2 py-1 rounded border border-[#EAECF0]">
                                      args: {JSON.stringify(t.arguments)}
                                    </pre>
                                  )}
                                </div>

                                {fixture ? (
                                  <div className="sm:text-right">
                                    <span className="text-[10px] font-semibold text-[#027A48] bg-[#E9F9EF] px-1.5 py-0.5 rounded">
                                      Mock Fixture Active
                                    </span>
                                    <pre className="text-[10px] font-mono text-[#71717A] mt-1 bg-white px-2 py-0.5 rounded border border-[#EAECF0] max-w-xs truncate">
                                      {JSON.stringify(fixture.response)}
                                    </pre>
                                  </div>
                                ) : (
                                  <span className="text-[10px] text-[#A1A1AA]">
                                    No mock fixture configured
                                  </span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ) : (
                        <div className="text-[11px] text-[#71717A] italic py-1">
                          No tool invocations expected for this test case.
                        </div>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>

      {/* Add / Edit Case Modal */}
      {modalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-xs">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Edit test case dialog"
            className="w-full max-w-lg rounded-2xl border border-[#EAECF0] bg-white p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto"
          >
            <div className="flex items-center justify-between border-b border-[#EAECF0] pb-3">
              <h2 className="text-base font-bold text-[#18181B]">
                {editingCase ? "Edit Test Case" : "Add New Test Case"}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="text-[#71717A] hover:text-[#18181B]"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {modalError && (
              <div className="flex items-center gap-2 rounded-lg bg-[#FEF3F2] border border-[#FEE4E2] p-2.5 text-xs text-[#B42318]">
                <AlertCircle className="h-4 w-4 shrink-0" />
                <span>{modalError}</span>
              </div>
            )}

            <form onSubmit={handleSaveCaseSubmit} className="space-y-3.5">
              <div className="space-y-1">
                <label className="text-xs font-semibold text-[#18181B]">Case Name</label>
                <input
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Refund policy boundary"
                  className="w-full rounded-lg border border-[#DCE1E8] bg-white px-3 py-1.5 text-xs text-[#18181B] focus:border-[#FF571A] focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-[#18181B] flex items-center justify-between">
                  <span>User Query / Input</span>
                  <span className="text-[10px] text-[#FF571A]">Required</span>
                </label>
                <textarea
                  rows={3}
                  value={formInput}
                  onChange={(e) => setFormInput(e.target.value)}
                  placeholder="The message or prompt sent to the agent..."
                  className="w-full rounded-lg border border-[#DCE1E8] bg-white p-2.5 text-xs text-[#18181B] focus:border-[#FF571A] focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-[#18181B]">
                  Expected Response (Ground Truth)
                </label>
                <textarea
                  rows={3}
                  value={formExpectedOutput}
                  onChange={(e) => setFormExpectedOutput(e.target.value)}
                  placeholder="The ideal answer for string or semantic matching..."
                  className="w-full rounded-lg border border-[#DCE1E8] bg-white p-2.5 text-xs text-[#18181B] focus:border-[#FF571A] focus:outline-none"
                />
              </div>

              <div className="space-y-1">
                <label className="text-xs font-semibold text-[#18181B]">
                  Tags (comma separated)
                </label>
                <input
                  type="text"
                  value={formTags}
                  onChange={(e) => setFormTags(e.target.value)}
                  placeholder="support, refunds, edge-case"
                  className="w-full rounded-lg border border-[#DCE1E8] bg-white px-3 py-1.5 text-xs text-[#18181B] focus:border-[#FF571A] focus:outline-none"
                />
              </div>

              <div className="flex items-center justify-end gap-2 border-t border-[#EAECF0] pt-3">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="rounded-lg border border-[#EAECF0] bg-white px-3.5 py-1.5 text-xs font-semibold text-[#18181B] hover:bg-[#F8F9FB]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex items-center gap-1.5 rounded-lg bg-[#FF571A] px-4 py-1.5 text-xs font-semibold text-white shadow-xs hover:bg-[#E0460D] disabled:opacity-50"
                >
                  {isSaving ? "Saving..." : "Save Test Case"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Start Evaluation Modal */}
      <StartEvaluationDialog
        isOpen={isStartEvalOpen}
        onClose={() => setIsStartEvalOpen(false)}
        workspaceId={workspaceId}
        datasets={[dataset]}
        defaultAgentId={dataset.agentId}
        defaultDatasetId={dataset.id}
        isPreview={isPreview}
        onRunCreated={(run) => {
          router.push(`${basePath}/runs/${run.id}`);
        }}
      />

      {/* Import CSV Modal */}
      <DatasetImportDialog
        isOpen={isImportOpen}
        onClose={() => setIsImportOpen(false)}
        workspaceId={workspaceId}
        datasetId={dataset.id}
        onImportSuccess={() => {
          router.refresh();
        }}
      />
    </div>
  );
}
