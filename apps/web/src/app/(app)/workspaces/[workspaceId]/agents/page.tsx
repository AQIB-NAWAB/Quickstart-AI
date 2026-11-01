import { loadWorkspaceShell } from "@/lib/server/auth/session";
import { gatewayFetch, getAccessTokenFromCookies } from "@/lib/server/gateway/fetch";
import { AgentList } from "@/features/agents/components/agent-list";
import type { Agent } from "@/features/agents/lib/types";

type Props = { params: { workspaceId: string } };

export default async function WorkspaceAgentsPage({ params }: Props) {
  const { activeWorkspace } = await loadWorkspaceShell(params.workspaceId);
  const token = await getAccessTokenFromCookies();

  const result = await gatewayFetch<{ agents: Agent[]; next_cursor?: string | null }>(
    `/v1/workspaces/${encodeURIComponent(activeWorkspace.id)}/agents?limit=50`,
    { accessToken: token },
  );

  const agents = result.ok ? result.data.agents : [];

  return (
    <div className="w-full">
      <AgentList
        workspaceId={activeWorkspace.id}
        workspaceName={activeWorkspace.name}
        initialAgents={agents}
        initialNextCursor={result.ok ? result.data.next_cursor ?? null : null}
      />
    </div>
  );
}
