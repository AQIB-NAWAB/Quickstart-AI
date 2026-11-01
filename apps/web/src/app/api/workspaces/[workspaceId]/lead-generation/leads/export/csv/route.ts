import { proxyBinaryToGateway } from "@/lib/server/gateway/proxy";

type Params = { params: { workspaceId: string } };

export async function POST(request: Request, { params }: Params) {
  const url = new URL(request.url);
  const qs = url.searchParams.toString();
  const path = `/v1/workspaces/${encodeURIComponent(params.workspaceId)}/lead-generation/leads/export/csv${qs ? `?${qs}` : ""}`;
  return proxyBinaryToGateway(path, null, "POST");
}
