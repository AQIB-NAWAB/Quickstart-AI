import { NextResponse } from "next/server";
import { proxyToGateway } from "@/lib/server/gateway/proxy";

type Params = { params: { workspaceId: string } };

export async function POST(request: Request, { params }: Params) {
  const { workspaceId } = params;
  const body = await request.json().catch(() => ({}));
  const path = `/v1/workspaces/${encodeURIComponent(workspaceId)}/voice/numbers/byo`;
  const result = await proxyToGateway<Record<string, unknown>>(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!result.ok) return result.response;
  return NextResponse.json(result.data, { status: result.status });
}
