import { backendAddress, connectionRequest } from "./backend-connection.server";

export async function proxyRuntime(request: Request) {
  const incoming = new URL(request.url);
  const web = new URL(process.env.RAPHIE_WEB_ORIGIN ?? "http://127.0.0.1:4320");
  const hosts = [`127.0.0.1:${web.port}`, `localhost:${web.port}`];
  if (!hosts.includes(incoming.host))
    return new Response("Unrecognized host.", { status: 403 });
  const origin = request.headers.get("origin");
  if (
    origin &&
    !hosts.map((host) => `${web.protocol}//${host}`).includes(origin)
  )
    return new Response("Unrecognized origin.", { status: 403 });
  if (incoming.pathname === "/api/web/connection")
    return connectionRequest(request);
  let base: string;
  try {
    base = backendAddress(request);
  } catch {
    return Response.json(
      { error: "Invalid local backend address." },
      { status: 400 },
    );
  }
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
