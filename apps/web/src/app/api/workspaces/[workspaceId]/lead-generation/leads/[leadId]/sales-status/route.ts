import { NextResponse } from "next/server";
import { proxyToGateway } from "@/lib/server/gateway/proxy";

type Params = { params: { workspaceId: string; leadId: string } };

export async function PATCH(request: Request, { params }: Params) {
  const body = await request.text();
  const path = `/v1/workspaces/${encodeURIComponent(params.workspaceId)}/lead-generation/leads/${encodeURIComponent(params.leadId)}/sales-status`;
  const result = await proxyToGateway<Record<string, unknown>>(path, {
    method: "PATCH",
    body,
    headers: { "Content-Type": "application/json" },
  });
  if (!result.ok) return result.response;
  return NextResponse.json(result.data, { status: result.status });
}
