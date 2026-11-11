"use client";

import { useState } from "react";
import type { VersionComparisonPoint } from "../lib/types";

interface VersionScoreComparisonProps {
  points: VersionComparisonPoint[];
  datasetName: string;
  datasetRevision: number;
  scoringPolicy: string;
  selectedVersion?: string;
  onSelectVersion?: (version: string) => void;
}

export function VersionScoreComparison({
  points,
  datasetName,
  datasetRevision,
  scoringPolicy,
  selectedVersion,
  onSelectVersion,
}: VersionScoreComparisonProps) {
  const [activeHover, setActiveHover] = useState<VersionComparisonPoint | null>(null);

  const chartHeight = 160;
  const chartWidth = 360;
  const barWidth = 44;
  const maxScore = 100;

  return (
    <div className="flex flex-col h-full rounded-xl border border-[#ededed] bg-white p-4 space-y-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-[#262626]">
            Version score comparison
          </h2>
          <p className="text-xs text-[#737373] mt-0.5">
            {datasetName} · rev{datasetRevision} · {scoringPolicy}
          </p>
        </div>

        {/* Version selectors */}
        <div className="flex items-center gap-1 rounded-lg border border-[#ededed] bg-[#f9f9f9] p-0.5 text-xs">
          {points.map((pt) => {
            const isSelected = pt.version === selectedVersion;
            return (
              <button
                key={pt.version}
                type="button"
                onClick={() => onSelectVersion?.(pt.version)}
                className={`rounded px-2.5 py-0.5 font-mono text-[11px] font-semibold transition-colors ${
                  isSelected
                    ? "bg-[#fa5d19] text-white shadow-xs"
                    : "text-[#737373] hover:text-[#262626]"
                }`}
              >
                {pt.version}
              </button>
            );
          })}
        </div>
      </div>

      {/* SVG Bar Chart */}
      <div className="flex-1 flex flex-col justify-end pt-2">
        {points.length === 0 && (
          <p className="text-xs text-[#737373]">No completed runs for this dataset revision and scoring policy.</p>
        )}
        <div className="relative w-full h-[150px]">
          <svg
            viewBox={`0 0 ${chartWidth} ${chartHeight + 30}`}
            className="w-full h-full overflow-visible"
          >
            {/* Grid lines and Y-axis labels */}
            {[100, 50, 0].map((val) => {
              const y = chartHeight - (val / maxScore) * chartHeight;
              return (
                <g key={val}>
                  <line
                    x1="30"
                    y1={y}
                    x2={chartWidth - 10}
                    y2={y}
                    stroke="#ededed"
                    strokeDasharray={val === 0 ? "none" : "3,3"}
                  />
                  <text
                    x="22"
                    y={y + 4}
                    textAnchor="end"
                    className="font-mono text-[10px] fill-[#a3a3a3]"
                  >
                    {val}
                  </text>
                </g>
              );
            })}

            {/* Bars */}
            {points.map((pt, idx) => {
              const spacing = (chartWidth - 60) / points.length;
              const x = 50 + idx * spacing + (spacing - barWidth) / 2;
              const barH = (pt.score / maxScore) * chartHeight;
              const y = chartHeight - barH;
              const isSelected = pt.version === selectedVersion;

              return (
                <g
                  key={pt.version}
                  className="cursor-pointer"
                  onMouseEnter={() => setActiveHover(pt)}
                  onMouseLeave={() => setActiveHover(null)}
                  onClick={() => onSelectVersion?.(pt.version)}
                >
                  {/* Score text on top */}
                  <text
                    x={x + barWidth / 2}
                    y={y - 6}
                    textAnchor="middle"
                    className="font-mono text-xs font-bold fill-[#262626]"
                  >
                    {pt.score}
                  </text>

                  {/* Rect Bar */}
                  <rect
                    x={x}
                    y={y}
                    width={barWidth}
                    height={barH}
                    rx="4"
                    fill={isSelected ? "#fa5d19" : "#ffbd9b"}
                    className="transition-colors hover:opacity-90"
                  />

                  {/* X-axis version label */}
                  <text
                    x={x + barWidth / 2}
                    y={chartHeight + 20}
                    textAnchor="middle"
                    className={`font-mono text-xs font-semibold ${
                      isSelected ? "fill-[#fa5d19]" : "fill-[#737373]"
                    }`}
                  >
                    {pt.version}
                  </text>
                </g>
              );
            })}
          </svg>

          {/* Hover Tooltip */}
          {activeHover && (
            <div className="absolute top-2 right-4 rounded-lg border border-[#ededed] bg-white p-2 text-xs shadow-md space-y-0.5 pointer-events-none">
              <div className="font-mono font-bold text-[#262626]">
                {activeHover.version} · {activeHover.score}/100
              </div>
              <div className="text-[11px] text-[#737373]">
                Passed: {activeHover.passed}/{activeHover.total} cases
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Footer */}
      <div className="pt-2 border-t border-[#ededed] text-[11px] text-[#a3a3a3] font-mono">
        Overall score /100 · {datasetName} rev{datasetRevision} · {scoringPolicy}
      </div>
    </div>
  );
}
