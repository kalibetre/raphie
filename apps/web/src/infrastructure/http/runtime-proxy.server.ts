import {
  backendAddress,
  connectionRequest,
  isRemoteGateway,
} from "./backend-connection.server";
import { remoteSession } from "./remote-session.server";

export async function proxyRuntime(request: Request) {
  const incoming = new URL(request.url);
  const web = new URL(process.env.RAPHIE_WEB_ORIGIN ?? "http://127.0.0.1:4320");
  const hosts = ["127.0.0.1", "localhost"].includes(web.hostname)
    ? [`127.0.0.1:${web.port}`, `localhost:${web.port}`]
    : [web.host];
  if (!hosts.includes(incoming.host))
    return new Response("Unrecognized host.", { status: 403 });
  const origin = request.headers.get("origin");
  if (
    origin &&
    !hosts.map((host) => `${web.protocol}//${host}`).includes(origin)
  )
    return new Response("Unrecognized origin.", { status: 403 });
  if (incoming.pathname === "/api/web/connection") {
    const response = await connectionRequest(request);
    response.headers.set("cache-control", "no-store");
    return response;
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
  // Pin a workspace's requests to its selection, including reconnecting SSE.
  // Another tab can change the shared cookie while this tab still has old state.
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
  const remote = remoteSession(request, base);
  const targetUrl = new URL(base);
  if (remote) {
    headers.set("authorization", `Bearer ${remote}`);
    headers.delete("origin");
  } else if (
    isRemoteGateway(request) ||
    !["127.0.0.1", "localhost"].includes(targetUrl.hostname) ||
    targetUrl.protocol === "https:"
  ) {
    return Response.json(
      {
        error: "Pair the remote gateway again.",
        code: "gateway_sign_in_required",
      },
      { status: 401 },
    );
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
    const responseHeaders = new Headers(response.headers);
    if (remote) responseHeaders.delete("set-cookie");
    return new Response(response.body, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch {
    return Response.json(
      { error: "The runtime is unavailable. Please retry." },
      { status: 503 },
    );
  }
}
