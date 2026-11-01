import { refreshSingleFlight } from "@/lib/server/auth/refresh-single-flight";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE_REFRESH } from "@/lib/server/auth/constants";
import { applyTokenCookies, clearTokenCookies, type TokenPair } from "@/lib/server/auth/cookies";
import { gatewayFetch } from "@/lib/server/gateway/fetch";

export async function POST() {
  const jar = await cookies();
  const refreshToken = jar.get(COOKIE_REFRESH)?.value;
  if (!refreshToken) {
    const res = NextResponse.json(
      { error: { code: "UNAUTHORIZED", message: "No refresh token" } },
      { status: 401 },
    );
    clearTokenCookies(res);
    return res;
  }

  const refreshed = await refreshSingleFlight(refreshToken, () => gatewayFetch<TokenPair>("/v1/refresh", {
    method: "POST",
    body: JSON.stringify({ refresh_token: refreshToken }),
  }));

  if (!refreshed.ok) {
    const res = NextResponse.json({ error: refreshed.error }, { status: refreshed.status || 401 });
    if (refreshed.status === 401) clearTokenCookies(res);
    return res;
  }

  const res = NextResponse.json({ ok: true });
  applyTokenCookies(res, refreshed.data);
  return res;
}
