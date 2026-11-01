import { loadWorkspaceShell } from "@/lib/server/auth/session";
import { gatewayFetch, getAccessTokenFromCookies } from "@/lib/server/gateway/fetch";
import { DatasetForm } from "@/features/evaluation/components/dataset-form";

export const metadata = {
  title: "New Dataset — QuickStart AI",
  description: "Create an evaluation benchmark dataset.",
};

interface Props {
  params: {
    workspaceId: string;
  };
}

export default async function NewDatasetPage({ params }: Props) {
  const { activeWorkspace } = await loadWorkspaceShell(params.workspaceId);
  const token = await getAccessTokenFromCookies();
  const agentsResult = await gatewayFetch<{ agents: Array<{ id: string; name: string }> }>(
    `/v1/workspaces/${encodeURIComponent(activeWorkspace.id)}/agents?limit=100`,
    { accessToken: token },
  );

  return (
    <div className="w-full">
      <DatasetForm
        workspaceId={activeWorkspace.id}
        isPreview={false}
        agents={agentsResult.ok ? agentsResult.data.agents : []}
      />
    </div>
  );
}
