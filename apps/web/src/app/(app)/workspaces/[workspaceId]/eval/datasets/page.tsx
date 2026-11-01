import { loadWorkspaceShell } from "@/lib/server/auth/session";
import { gatewayFetch, getAccessTokenFromCookies } from "@/lib/server/gateway/fetch";
import { getEvaluationRepository } from "@/features/evaluation/lib/repository";
import { DatasetList } from "@/features/evaluation/components/dataset-list";
import { EvaluationState } from "@/features/evaluation/components/evaluation-state";

export const metadata = {
  title: "Evaluation Datasets — QuickStart AI",
  description: "Manage test datasets and benchmarks for agent evaluation.",
};

interface Props {
  params: {
    workspaceId: string;
  };
}

export default async function WorkspaceDatasetsPage({ params }: Props) {
  const { activeWorkspace } = await loadWorkspaceShell(params.workspaceId);
  const token = await getAccessTokenFromCookies();
  const repo = getEvaluationRepository(false);

  const [datasetsResult, overviewResult, agentsResult] = await Promise.all([
    repo.listDatasets(activeWorkspace.id),
    repo.getOverview(activeWorkspace.id, "all").catch(() => null),
    gatewayFetch<{ agents: Array<{ id: string; name: string }> }>(
      `/v1/workspaces/${encodeURIComponent(activeWorkspace.id)}/agents?limit=100`,
      { accessToken: token },
    ),
  ]);

  if (datasetsResult.status !== "ready") {
    return (
      <div className="w-full">
        <EvaluationState status={datasetsResult.status} message={datasetsResult.message} />
      </div>
    );
  }

  const summary =
    overviewResult && overviewResult.status === "ready" ? overviewResult.data.summary : undefined;

  return (
    <div className="w-full">
      <DatasetList
        workspaceId={activeWorkspace.id}
        datasets={datasetsResult.data}
        summary={summary}
        isPreview={false}
        agentId={agentsResult.ok ? agentsResult.data.agents[0]?.id : undefined}
      />
    </div>
  );
}
