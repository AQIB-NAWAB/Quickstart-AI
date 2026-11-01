"use client";
import React, { useState } from "react";
import { CheckCircle2, Clock, XCircle } from "lucide-react";
import type { GraphExecutionTrace } from "@quickstart/contracts";
export type ExecutionTracePanelProps = {
  trace: GraphExecutionTrace | null;
  onSelectNode?: (id: string) => void;
};
export const ExecutionTracePanel: React.FC<ExecutionTracePanelProps> = ({
  trace,
  onSelectNode,
}) => {
  const [selected, setSelected] = useState<string | null>(null),
    [tab, setTab] = useState<"inputs" | "outputs" | "details">("outputs");
  const steps = (trace?.steps ?? trace?.events ?? []).filter((e) => e.status !== "running");
  const event = steps.find((e) => e.event_id === selected) ?? steps[steps.length - 1];
  return (
    <section className="h-full flex flex-col min-h-0 bg-white" aria-label="Execution trace">
      <header className="h-11 flex items-center gap-4 px-5 border-b border-[#EDEDED] shrink-0">
        <h2 className="text-sm font-semibold">Execution trace</h2>
        <span className="text-xs text-neutral-500">
          {steps.length ? `${steps.length} steps` : "No execution yet"}
        </span>
        {trace && (
          <span
            className={`text-xs rounded px-2 py-1 ${trace.status === "failed" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"}`}
          >
            {trace.status.replaceAll("_", " ")}
          </span>
        )}
        <span className="ml-auto text-xs text-neutral-500">
          {trace
            ? `${trace.total_duration_ms ?? trace.duration_ms ?? 0} ms${trace.release_id ? ` · release ${trace.release_id.slice(0, 8)}` : ""}`
            : ""}
        </span>
      </header>
      {!event ? (
        <div className="flex-1 flex items-center justify-center text-xs text-neutral-500">
          Start a preview to inspect real node inputs and outputs.
        </div>
      ) : (
        <div className="flex-1 min-h-0 grid grid-cols-[40%_60%]">
          <div className="overflow-y-auto border-r border-[#EDEDED] p-2">
            {steps.map((e) => (
              <button
                key={e.event_id}
                onClick={() => {
                  setSelected(e.event_id);
                  onSelectNode?.(e.node_id);
                }}
                className={`w-full flex items-center gap-3 rounded-md px-3 py-2 text-xs ${event.event_id === e.event_id ? "bg-[#FA5D19]/10" : "hover:bg-neutral-50"}`}
              >
                {e.status === "failed" ? (
                  <XCircle className="w-4 h-4 text-red-600" />
                ) : e.status === "waiting_for_input" ? (
                  <Clock className="w-4 h-4 text-amber-600" />
                ) : (
                  <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                )}
                <span className="truncate">{e.node_name}</span>
                <span className="ml-auto text-neutral-500">{e.duration_ms} ms</span>
              </button>
            ))}
          </div>
          <div className="min-w-0 flex flex-col px-4 py-2">
            <h3 className="text-xs font-semibold">{event.node_name}</h3>
            <div className="flex gap-6 text-xs border-b border-[#EDEDED] shrink-0">
              {(["inputs", "outputs", "details"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  className={`py-2 capitalize border-b-2 ${tab === t ? "border-[#FA5D19]" : "border-transparent text-neutral-500"}`}
                >
                  {t === "inputs" ? "Input" : t === "outputs" ? "Output" : "Details"}
                </button>
              ))}
            </div>
            <pre className="mt-2 min-h-0 flex-1 overflow-auto rounded-md border border-[#EDEDED] bg-[#FAFAFA] p-3 text-[11px] font-mono whitespace-pre-wrap">
              {JSON.stringify(
                tab === "inputs"
                  ? event.inputs
                  : tab === "outputs"
                    ? event.outputs
                    : {
                        status: event.status,
                        branch: event.chosen_branch_port,
                        error: event.error,
                      },
                null,
                2,
              )}
            </pre>
          </div>
        </div>
      )}
    </section>
  );
};
