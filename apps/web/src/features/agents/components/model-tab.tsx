"use client";

import { useEffect, useRef, useState } from "react";
import {
  CheckCircle2,
  ChevronDown,
  Cpu,
  FileText,
  Sliders,
} from "lucide-react";
import { getAgentCatalog } from "../lib/client";

type Props = {
  workspaceId: string;
  model: string;
  temperature: number;
  maxTokens: number;
  reasoningEffort: string;
  verbosity: string;
  isDirty: boolean;
  onChangeModel: (model: string) => void;
  onChangeTemperature: (temp: number) => void;
  onChangeMaxTokens: (tokens: number) => void;
  onChangeReasoningEffort: (effort: string) => void;
  onChangeVerbosity: (verbosity: string) => void;
};

type ModelOption = {
  id: string;
  name: string;
  provider: string;
  desc: string;
};

export function ModelTab({
  workspaceId,
  model,
  temperature,
  maxTokens,
  isDirty,
  onChangeModel,
  onChangeTemperature,
  onChangeMaxTokens,
  reasoningEffort,
  verbosity,
  onChangeReasoningEffort,
  onChangeVerbosity,
}: Props) {
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [catalogModels, setCatalogModels] = useState<ModelOption[]>([]);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let active = true;
    void getAgentCatalog(workspaceId).then((result) => {
      if (!active || !result.catalog) return;
      setCatalogModels(
        result.catalog.models
          .filter((item) => item.enabled)
          .map((item) => ({
            id: item.id,
            name: item.name,
            provider: item.provider,
            desc: item.description,
          })),
      );
    });
    return () => {
      active = false;
    };
  }, [workspaceId]);

  // Keep an already-saved custom model visible until the backend catalog is updated.
  const models = catalogModels.length > 0 ? [...catalogModels] : [];
  if (!models.some((m) => m.id === model)) {
    models.unshift({
      id: model,
      name: model,
      provider: "Custom",
      desc: "Currently configured model",
    });
  }

  const selectedModel = models.find((m) => m.id === model) || models[0];
  const isAstra = /^gpt-6-astra/i.test(model);
  const isSol = /^gpt-6\.1-sol/i.test(model);

  useEffect(() => {
    // Avoid saving settings the selected reasoning model will reject. This is
    // also guarded at runtime for older saved versions.
    if ((isAstra && (reasoningEffort === "none" || reasoningEffort === "minimal")) ||
        (isSol && (reasoningEffort === "none" || reasoningEffort === "minimal"))) {
      onChangeReasoningEffort("low");
    }
  }, [isAstra, isSol, reasoningEffort, onChangeReasoningEffort]);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  // Compute slider fill percentage
  const tempPercent = Math.min(Math.max((temperature / 1) * 100, 0), 100);

  return (
    <div className="space-y-6 max-w-full">
      {/* Title & Subtitle matching 3.png */}
      <div>
        <h2 className="text-[24px] font-semibold text-[#202125]">Model &amp; parameters</h2>
        <p className="mt-1 text-[14px] text-[#667085]">
          Choose how your agent generates responses.
        </p>
      </div>

      {/* Full-width Language Model Card matching 3.png */}
      <div className="bg-white border border-[#DCE1E8] rounded-[8px] overflow-hidden shadow-xs">
        <div className="px-5 py-3 border-b border-[#EAECF0] flex items-center gap-2.5">
          <FileText className="w-4 h-4 text-[#667085]" />
          <span className="text-[14px] font-semibold text-[#202125]">Language model</span>
        </div>

        <div className="p-6 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="md:max-w-xs">
            <label id="model-select-label" className="block text-[15px] font-semibold text-[#202125]">
              Model
            </label>
            <p className="mt-0.5 text-[14px] text-[#667085]">
              Used for your agent&apos;s responses.
            </p>
          </div>

          <div className="relative flex-1 max-w-[560px]" ref={dropdownRef}>
            <button
              type="button"
              onClick={() => setDropdownOpen((v) => !v)}
              aria-labelledby="model-select-label"
              aria-haspopup="listbox"
              aria-expanded={dropdownOpen}
              className="w-full flex items-center justify-between p-3.5 bg-white border border-[#DCE1E8] rounded-[8px] shadow-xs hover:border-[#B6C0C9] transition-colors text-left"
            >
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-8 h-8 rounded-[6px] bg-[#F2F4F7] border border-[#DCE1E8] text-[#202125] flex items-center justify-center shrink-0">
                  <Cpu className="w-4 h-4 text-[#667085]" />
                </div>
                <div className="min-w-0">
                  <span className="block text-[15px] font-semibold text-[#202125] truncate leading-tight">
                    {selectedModel?.name ?? model}
                  </span>
                  <span className="block text-[13px] text-[#667085] leading-tight mt-0.5">
                    {selectedModel?.provider ?? "Configured model"}
                  </span>
                </div>
              </div>
              <ChevronDown
                className={`w-4 h-4 text-[#667085] shrink-0 transition-transform ${
                  dropdownOpen ? "rotate-180" : ""
                }`}
              />
            </button>

            {dropdownOpen && (
              <div
                role="listbox"
                className="absolute left-0 right-0 top-[calc(100%+6px)] z-30 max-h-64 overflow-y-auto bg-white border border-[#DCE1E8] rounded-[8px] shadow-xl py-1"
              >
                {models.map((m) => {
                  const isSelected = m.id === model;
                  return (
                    <button
                      key={m.id}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => {
                        onChangeModel(m.id);
                        setDropdownOpen(false);
                      }}
                      className={`w-full flex items-center justify-between p-3 text-left transition-colors ${
                        isSelected
                          ? "bg-[#FFF3ED] text-[#FF571A] font-medium"
                          : "hover:bg-[#F8F9FA] text-[#202125]"
                      }`}
                    >
                      <div>
                        <div className="text-[14px] font-medium leading-tight">{m.name}</div>
                        <div className="text-[12px] text-[#667085] mt-0.5 leading-tight">{m.desc}</div>
                      </div>
                      <span className="text-[12px] font-mono px-2 py-0.5 rounded bg-[#F2F4F7] text-[#344054]">
                        {m.provider}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Two Equal-Width Setting Cards with 20-24px gap matching 3.png */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
        {/* Left Card: Temperature */}
        <div className="bg-white border border-[#DCE1E8] rounded-[8px] p-6 shadow-xs flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Sliders className="w-4 h-4 text-[#667085]" />
                <label htmlFor="temp-input" className="text-[15px] font-semibold text-[#202125]">
                  Temperature
                </label>
              </div>

              <input
                id="temp-input"
                type="number"
                min="0"
                max="1"
                step="0.05"
                value={temperature}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!isNaN(v) && v >= 0 && v <= 1) {
                    onChangeTemperature(v);
                  }
                }}
                className="w-16 h-9 px-2 text-center text-[14px] font-mono font-medium text-[#202125] bg-white border border-[#DCE1E8] rounded-[6px] focus:outline-none focus:border-[#FF571A]"
              />
            </div>

            <p className="mt-1.5 text-[14px] text-[#667085]">
              Lower values give more consistent responses.
            </p>
          </div>

          <div className="space-y-3 pt-2">
            {/* Custom Slider with orange active track */}
            <div className="relative flex items-center">
              <input
                aria-label="Temperature slider"
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={temperature}
                onChange={(e) => onChangeTemperature(parseFloat(e.target.value))}
                className="w-full h-1.5 rounded-lg appearance-none cursor-pointer bg-transparent focus:outline-none z-10 [&::-webkit-slider-thumb]:appearance-none [&::-webkit-slider-thumb]:w-4 [&::-webkit-slider-thumb]:h-4 [&::-webkit-slider-thumb]:rounded-full [&::-webkit-slider-thumb]:bg-white [&::-webkit-slider-thumb]:border-2 [&::-webkit-slider-thumb]:border-[#FF571A] [&::-webkit-slider-thumb]:shadow-xs [&::-moz-range-thumb]:w-4 [&::-moz-range-thumb]:h-4 [&::-moz-range-thumb]:rounded-full [&::-moz-range-thumb]:bg-white [&::-moz-range-thumb]:border-2 [&::-moz-range-thumb]:border-[#FF571A]"
                style={{
                  background: `linear-gradient(to right, #FF571A 0%, #FF571A ${tempPercent}%, #EAECF0 ${tempPercent}%, #EAECF0 100%)`,
                }}
              />
            </div>

            <div className="flex items-center justify-between text-[13px] text-[#667085]">
              <span>0 · Consistent</span>
              <span>1 · Varied</span>
            </div>
          </div>
        </div>

        {/* Right Card: Maximum response tokens */}
        <div className="bg-white border border-[#DCE1E8] rounded-[8px] p-6 shadow-xs flex flex-col justify-between space-y-4">
          <div>
            <div className="flex items-center gap-2">
              <FileText className="w-4 h-4 text-[#667085]" />
              <label htmlFor="max-tokens-input" className="text-[15px] font-semibold text-[#202125]">
                Maximum response tokens
              </label>
            </div>
            <p className="mt-1.5 text-[14px] text-[#667085]">
              The upper limit for a single reply.
            </p>
          </div>

          <div className="space-y-2 pt-1">
            <input
              id="max-tokens-input"
              type="number"
              min="128"
              max="16384"
              step="128"
              value={maxTokens}
              onChange={(e) => {
                const v = parseInt(e.target.value, 10);
                if (!isNaN(v) && v >= 128 && v <= 16384) {
                  onChangeMaxTokens(v);
                }
              }}
              className="w-full h-10 px-3.5 text-[14px] font-mono text-[#202125] bg-white border border-[#DCE1E8] rounded-[6px] focus:outline-none focus:border-[#FF571A] transition-colors"
            />
            <p className="text-[13px] text-[#667085]">A limit, not a target length.</p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 items-stretch">
        <div className="bg-white border border-[#DCE1E8] rounded-[8px] p-6 shadow-xs space-y-3">
          <div>
            <label htmlFor="reasoning-effort" className="text-[15px] font-semibold text-[#202125]">
              Reasoning effort
            </label>
            <p className="mt-1 text-[14px] text-[#667085]">
              Higher effort improves difficult planning and tool decisions, with more latency.
            </p>
          </div>
          <select
            id="reasoning-effort"
            value={reasoningEffort}
            onChange={(event) => onChangeReasoningEffort(event.target.value)}
            className="w-full h-10 px-3 text-[14px] text-[#202125] bg-white border border-[#DCE1E8] rounded-[6px] focus:outline-none focus:border-[#FF571A]"
          >
            <option value="auto">Auto by model</option>
            <option value="none" disabled={isAstra || isSol}>None (fastest)</option>
            <option value="minimal" disabled={isAstra || isSol}>Minimal</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="xhigh">Extra high</option>
            <option value="max">Maximum</option>
          </select>
        </div>

        <div className="bg-white border border-[#DCE1E8] rounded-[8px] p-6 shadow-xs space-y-3">
          <div>
            <label htmlFor="output-verbosity" className="text-[15px] font-semibold text-[#202125]">
              Output verbosity
            </label>
            <p className="mt-1 text-[14px] text-[#667085]">
              Controls answer detail without changing the agent’s instructions.
            </p>
          </div>
          <select
            id="output-verbosity"
            value={verbosity}
            onChange={(event) => onChangeVerbosity(event.target.value)}
            className="w-full h-10 px-3 text-[14px] text-[#202125] bg-white border border-[#DCE1E8] rounded-[6px] focus:outline-none focus:border-[#FF571A]"
          >
            <option value="low">Low — concise</option>
            <option value="medium">Medium — balanced</option>
            <option value="high">High — detailed</option>
          </select>
        </div>
      </div>

      {/* Save-state strip below cards matching 3.png */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-1 text-[13px]">
        <div className="flex items-center gap-2">
          {isDirty ? (
            <>
              <span className="w-2 h-2 rounded-full bg-[#F79009]" />
              <span className="text-[#B54708] font-medium">Unsaved changes</span>
            </>
          ) : (
            <>
              <CheckCircle2 className="w-4 h-4 text-[#168A45]" />
              <span className="text-[#168A45] font-medium">All changes saved to draft</span>
            </>
          )}
        </div>

        <div className="flex items-center gap-2 text-[#667085]">
          <FileText className="w-4 h-4 text-[#667085]" aria-hidden="true" />
          <span>Publish to update your live agent</span>
        </div>
      </div>
    </div>
  );
}
