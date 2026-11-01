"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";

type Props = {
  currentVersion: number;
  onReload: () => void;
  onKeepLocalDraft: () => void;
};

export function ConflictBanner({ currentVersion, onReload, onKeepLocalDraft }: Props) {
  return (
    <div className="rounded-[8px] border border-amber-300 bg-amber-50 p-4 text-amber-900 shadow-sm animate-in fade-in slide-in-from-top-1">
      <div className="flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <div className="flex-1 min-w-0">
          <h4 className="text-[14px] font-semibold text-amber-900">
            Version Conflict Detected (HTTP 409)
          </h4>
          <p className="mt-1 text-[13px] text-amber-800 leading-relaxed">
            Another team member or window saved changes while you were editing. To prevent
            overwriting their work, saving is locked until you choose how to resolve this conflict (latest server version v{currentVersion}).
          </p>
          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={onReload}
              className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-[6px] bg-amber-700 text-white text-[12px] font-medium hover:bg-amber-800 transition-colors shadow-sm"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reload Latest Server Version
            </button>
            <button
              type="button"
              onClick={onKeepLocalDraft}
              className="inline-flex items-center px-3.5 py-1.5 rounded-[6px] border border-amber-400 bg-white text-amber-900 text-[12px] font-medium hover:bg-amber-100 transition-colors"
            >
              Keep My Draft
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
