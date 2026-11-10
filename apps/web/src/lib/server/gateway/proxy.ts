import { refreshSingleFlight } from "../auth/refresh-single-flight";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE_ACCESS, COOKIE_REFRESH } from "../auth/constants";
import { type TokenPair } from "../auth/cookies";
import { accessTokenNeedsRefresh } from "../auth/jwt";
import { gatewayFetch, getAccessTokenFromCookies, type GatewayError } from "./fetch";
import { gatewayBaseUrl } from "./fetch";

type ProxyOk<T> = { ok: true; data: T; status: number };
type ProxyFail = { ok: false; response: NextResponse };

async function tryRefreshToken(): Promise<string | null> {
  try {
    const jar = await cookies();
    const refreshToken = jar.get(COOKIE_REFRESH)?.value;
    if (!refreshToken) return null;

    const refreshed = await refreshSingleFlight(refreshToken, () => gatewayFetch<TokenPair>("/v1/refresh", {
      method: "POST",
      body: JSON.stringify({ refresh_token: refreshToken }),
    }));

    if (!refreshed.ok || !refreshed.data?.access_token) return null;

    jar.set(COOKIE_ACCESS, refreshed.data.access_token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.max(60, refreshed.data.expires_in),
    });

    if (refreshed.data.refresh_token) {
      jar.set(COOKIE_REFRESH, refreshed.data.refresh_token, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 30,
      });
    }

    return refreshed.data.access_token;
  } catch {
    return null;
  }
}

export async function proxyToGateway<T>(
  path: string,
  init?: RequestInit,
): Promise<ProxyOk<T> | ProxyFail> {
  let token = await getAccessTokenFromCookies();

  if (!token || accessTokenNeedsRefresh(token, 30)) {
    const refreshed = await tryRefreshToken();
    if (refreshed) {
      token = refreshed;
    }
  }

  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        {
          error: { code: "UNAUTHORIZED", message: "Not signed in" } as GatewayError,
        },
        { status: 401 },
      ),
    };
  }

  let result = await gatewayFetch<T>(path, { ...init, accessToken: token });

  if (!result.ok && result.status === 401) {
    const freshToken = await tryRefreshToken();
    if (freshToken) {
      result = await gatewayFetch<T>(path, { ...init, accessToken: freshToken });
    }
  }

  if (!result.ok) {
    return {
      ok: false,
      response: NextResponse.json({ error: result.error }, { status: result.status || 502 }),
    };
  }

  return { ok: true, data: result.data, status: result.status };
}

export async function proxyBinaryToGateway(path: string, range?: string | null, method: "GET" | "POST" = "GET"): Promise<NextResponse> {
  let token = await getAccessTokenFromCookies();
  if (!token || accessTokenNeedsRefresh(token, 30)) token = (await tryRefreshToken()) ?? token;
  if (!token) return NextResponse.json({ error: { code: "UNAUTHORIZED", message: "Not signed in" } }, { status: 401 });

  const send = (accessToken: string) => fetch(`${gatewayBaseUrl()}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(range ? { Range: range } : {}),
    },
    cache: "no-store",
  });
  let upstream: Response;
  try {
    upstream = await send(token);
    if (upstream.status === 401) {
      const refreshed = await tryRefreshToken();
      if (refreshed) upstream = await send(refreshed);
    }
  } catch {
    return NextResponse.json({ error: { code: "UPSTREAM_UNAVAILABLE", message: "Gateway is unavailable" } }, { status: 502 });
  }
  if (!upstream.ok) {
    const body = await upstream.json().catch(() => ({}));
    return NextResponse.json(body, { status: upstream.status });
  }
  const headers = new Headers();
  for (const name of ["content-type", "content-length", "content-range", "accept-ranges", "content-disposition"]) {
    const value = upstream.headers.get(name);
    if (value) headers.set(name, value);
  }
  headers.set("Cache-Control", "private, no-store");
  return new NextResponse(upstream.body, { status: upstream.status, headers });
}

export async function proxyMultipartToGateway<T>(
  path: string,
  request: Request,
): Promise<ProxyOk<T> | ProxyFail> {
  let token = await getAccessTokenFromCookies();
  if (!token || accessTokenNeedsRefresh(token, 30)) {
    const refreshed = await tryRefreshToken();
    if (refreshed) token = refreshed;
  }
  if (!token) {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "UNAUTHORIZED", message: "Not signed in" } },
        { status: 401 },
      ),
    };
  }

  const contentType = request.headers.get("content-type") || "";
  const send = (accessToken: string) =>
    fetch(`${gatewayBaseUrl()}${path}`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": contentType,
      },
      body: request.body,
      // @ts-expect-error duplex is required in Node fetch for streaming bodies
      duplex: "half",
      cache: "no-store",
    });

  let upstream: Response;
  try {
    upstream = await send(token);
    if (upstream.status === 401) {
      const refreshed = await tryRefreshToken();
      if (refreshed) upstream = await send(refreshed);
    }
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: { code: "UPSTREAM_UNAVAILABLE", message: "Gateway is unavailable" } },
        { status: 502 },
      ),
    };
  }

  const body = (await upstream.json().catch(() => ({}))) as Record<string, unknown>;
  if (!upstream.ok) {
    return {
      ok: false,
      response: NextResponse.json(body, { status: upstream.status }),
    };
  }

  return { ok: true, data: body as unknown as T, status: upstream.status };
}
