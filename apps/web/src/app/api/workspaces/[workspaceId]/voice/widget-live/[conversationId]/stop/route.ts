import { NextResponse } from "next/server";
import { proxyToGateway } from "@/lib/server/gateway/proxy";

type Params = { params: { workspaceId: string; conversationId: string } };

export async function POST(_request: Request, { params }: Params) {
  const path = `/v1/workspaces/${encodeURIComponent(params.workspaceId)}/voice/widget-live/${encodeURIComponent(params.conversationId)}/stop`;
  const result = await proxyToGateway<Record<string, unknown>>(path, { method: "POST" });
  if (!result.ok) return result.response;
  return NextResponse.json(result.data, { status: result.status });
}
