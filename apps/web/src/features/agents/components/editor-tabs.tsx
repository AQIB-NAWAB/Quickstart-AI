"use client";

import Link from "next/link";

export type EditorTabKey =
  | "instructions"
  | "model"
  | "tools"
  | "policies"
  | "identity"
  | "releases"
  | "observability"
  | "evaluation";

type Props = {
  activeTab: EditorTabKey;
  onTabChange: (tab: EditorTabKey) => void;
  workspaceId: string;
  agentId: string;
};

export function EditorTabs({ activeTab, onTabChange, workspaceId, agentId }: Props) {
  const tabs: { key: EditorTabKey; label: string; isLink?: boolean; href?: string }[] = [
    { key: "instructions", label: "Instructions" },
    { key: "model", label: "Model" },
    { key: "tools", label: "Tools" },
    { key: "policies", label: "Knowledge & safety" },
    { key: "identity", label: "Identity & channels" },
    { key: "releases", label: "Releases" },
    { key: "observability", label: "Observability" },
    {
      key: "evaluation",
      label: "Evaluation",
      isLink: true,
      href: `/workspaces/${workspaceId}/agents/${agentId}/eval`,
    },
  ];

  return (
    <div className="border-b border-[#EAECF0] overflow-x-auto select-none">
      <nav aria-label="Editor sections" className="flex items-center gap-6 sm:gap-8 text-[15px]">
        {tabs.map((tab) => {
          const isActive = activeTab === tab.key;

          if (tab.isLink && tab.href) {
            return (
              <Link
                key={tab.key}
                href={tab.href}
                className={`py-3.5 whitespace-nowrap transition-colors border-b-2 font-medium ${
                  isActive
                    ? "border-[#FF571A] text-[#202125] font-semibold"
                    : "border-transparent text-[#667085] hover:text-[#202125]"
                }`}
              >
                {tab.label}
              </Link>
            );
          }

          return (
            <button
              key={tab.key}
              type="button"
              onClick={() => onTabChange(tab.key)}
              className={`py-3.5 whitespace-nowrap transition-colors border-b-2 font-medium ${
                isActive
                  ? "border-[#FF571A] text-[#202125] font-semibold"
                  : "border-transparent text-[#667085] hover:text-[#202125]"
              }`}
            >
              {tab.label}
            </button>
          );
        })}
      </nav>
    </div>
  );
}
