import { NextResponse } from "next/server";
import { proxyToGateway } from "@/lib/server/gateway/proxy";

type Params = { params: { workspaceId: string; connectorId: string } };

export async function GET(_request: Request, { params }: Params) {
  const path = `/v1/workspaces/${encodeURIComponent(params.workspaceId)}/lead-generation/connectors/${encodeURIComponent(params.connectorId)}/batches`;
  const result = await proxyToGateway<Record<string, unknown>>(path);
  if (!result.ok) return result.response;
  return NextResponse.json(result.data, { status: result.status });
}
