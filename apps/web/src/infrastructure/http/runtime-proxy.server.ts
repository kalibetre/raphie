import { webOrigins } from "../auth/auth-storage";
import { backendAddress } from "./backend-connection.server";

export async function proxyRuntime(request: Request) {
  const incoming = new URL(request.url);
  const origins = webOrigins(
    process.env.RAPHIE_WEB_ORIGIN,
    Number(process.env.RAPHIE_WEB_PORT ?? 4320),
  );
  const expectedOrigin = origins.find(
    (value) => new URL(value).host === incoming.host,
  );
  if (!expectedOrigin)
    return new Response("Unrecognized host.", { status: 403 });
  const origin = request.headers.get("origin");
  if (origin && origin !== expectedOrigin)
    return new Response("Unrecognized origin.", { status: 403 });
  if (incoming.pathname === "/api/web/connection") {
    if (request.method !== "GET")
      return new Response("Method not allowed.", { status: 405 });
    try {
      return Response.json(
        { url: backendAddress(request) },
        { headers: { "cache-control": "no-store" } },
      );
    } catch {
      return new Response("Invalid local backend address.", { status: 500 });
    }
  }
  let base: string;
  try {
    base = backendAddress(request);
  } catch {
    return Response.json(
      { error: "Invalid local backend address." },
      { status: 400 },
    );
  }
  // Reject requests from a workspace opened against an earlier runtime configuration.
  const expected =
    request.headers.get("x-raphie-backend") ??
    incoming.searchParams.get("_raphie_backend");
  if (expected && expected !== base)
    return Response.json(
      {
        error: "The backend selection changed. Reconnect to continue.",
        code: "backend_changed",
      },
      { status: 409 },
    );
  incoming.searchParams.delete("_raphie_backend");
  const target = new URL(incoming.pathname + incoming.search, base);
  const headers = new Headers();
  for (const key of ["content-type", "x-raphie-client", "origin"]) {
    const value = request.headers.get(key);
    if (value) headers.set(key, value);
  }
  try {
    const response = await fetch(target, {
      method: request.method,
      redirect: "error",
      headers,
      signal: request.signal,
      ...(request.method === "POST"
        ? { body: request.body, duplex: "half" }
        : {}),
    } as RequestInit);
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    });
  } catch {
    return Response.json(
      { error: "The runtime is unavailable. Please retry." },
      { status: 503 },
    );
  }
}
