import { NextResponse } from "next/server";
import { proxyToGateway } from "@/lib/server/gateway/proxy";

type Params = { params: { workspaceId: string; scheduleId: string } };

export async function GET(_request: Request, { params }: Params) {
  const path = `/v1/workspaces/${encodeURIComponent(params.workspaceId)}/lead-generation/schedules/${encodeURIComponent(params.scheduleId)}`;
  const result = await proxyToGateway<Record<string, unknown>>(path);
  if (!result.ok) return result.response;
  return NextResponse.json(result.data, { status: result.status });
}

export async function PATCH(request: Request, { params }: Params) {
  const body = await request.text();
  const path = `/v1/workspaces/${encodeURIComponent(params.workspaceId)}/lead-generation/schedules/${encodeURIComponent(params.scheduleId)}`;
  const result = await proxyToGateway<Record<string, unknown>>(path, {
    method: "PATCH",
    body,
    headers: { "Content-Type": "application/json" },
  });
  if (!result.ok) return result.response;
  return NextResponse.json(result.data, { status: result.status });
}

export async function DELETE(_request: Request, { params }: Params) {
  const path = `/v1/workspaces/${encodeURIComponent(params.workspaceId)}/lead-generation/schedules/${encodeURIComponent(params.scheduleId)}`;
  const result = await proxyToGateway<Record<string, unknown>>(path, {
    method: "DELETE",
  });
  if (!result.ok) return result.response;
  return NextResponse.json(result.data, { status: result.status });
}
