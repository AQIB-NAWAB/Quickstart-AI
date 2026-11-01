import { LeadGenerationConnectorsPage } from "@/features/lead-generation/components/connectors-page";

export default function Page({ params }: { params: { workspaceId: string } }) {
  return <LeadGenerationConnectorsPage workspaceId={params.workspaceId} />;
}
