import { NextResponse } from "next/server";
import { proxyToGateway } from "@/lib/server/gateway/proxy";

type Params = { params: { workspaceId: string; agentId: string } };

export async function POST(request: Request, { params }: Params) {
  const body = await request.text();
  const path = `/v1/workspaces/${encodeURIComponent(params.workspaceId)}/agents/${encodeURIComponent(params.agentId)}/schedule-release`;
  const result = await proxyToGateway<Record<string, unknown>>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body,
  });
  if (!result.ok) return result.response;
  return NextResponse.json(result.data, { status: result.status });
}
