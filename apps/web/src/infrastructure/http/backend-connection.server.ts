import {
  discardRemoteHandle,
  discardRemoteSession,
  loginRemote,
  remoteAddress,
  remoteCookie,
} from "./remote-session.server";

const backendCookie = (request: Request) =>
  `raphie_backend_${new URL(request.url).port || "80"}`;
const kindCookie = (request: Request) =>
  `raphie_gateway_kind_${new URL(request.url).port || "80"}`;
const cookieSecurity = () =>
  process.env.RAPHIE_WEB_ORIGIN?.startsWith("https://") ? "; Secure" : "";

export function isRemoteGateway(request: Request): boolean {
  return (
    request.headers
      .get("cookie")
      ?.split(";")
      .some((part) => part.trim() === `${kindCookie(request)}=remote`) ?? false
  );
}

export function localBackend(value: string, webPort?: string) {
  const url = new URL(value);
  if (
    url.protocol !== "http:" ||
    !["127.0.0.1", "localhost"].includes(url.hostname) ||
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    (webPort && url.port === webPort)
  )
    throw new Error(
      "Use a local HTTP backend address, such as http://127.0.0.1:4316.",
    );
  return url.origin;
}

export function backendAddress(request: Request) {
  const cookieName = backendCookie(request);
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  const value = cookie
    ? decodeURIComponent(cookie.slice(cookieName.length + 1))
    : (process.env.RAPHIE_RUNTIME_URL ?? "http://127.0.0.1:4316");
  if (new URL(value).host === new URL(request.url).host)
    throw new Error("Gateway cannot point to this web server.");
  try {
    return localBackend(value, new URL(request.url).port);
  } catch {
    return remoteAddress(value);
  }
}

/** This endpoint belongs to the web host so an offline backend can be replaced. */
export async function connectionRequest(request: Request) {
  try {
    if (request.method === "GET")
      return Response.json({
        url: backendAddress(request),
        kind: isRemoteGateway(request) ? "remote" : "local",
      });
    if (request.method !== "POST")
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    if (request.headers.get("x-raphie-client") !== "web")
      return Response.json(
        { error: "Unrecognized request origin." },
        { status: 403 },
      );
    if (Number(request.headers.get("content-length") ?? 0) > 8192)
      throw new Error("Invalid connection request.");
    const text = await request.text();
    if (text.length > 8192) throw new Error("Invalid connection request.");
    const input = JSON.parse(text);
    if (
      typeof input.url !== "string" ||
      !["test", "connect"].includes(input.action)
    )
      throw new Error("Invalid connection request.");
    if (input.kind === "remote") {
      const url = remoteAddress(input.url);
      if (new URL(url).host === new URL(request.url).host)
        throw new Error("Gateway cannot point to this web server.");
      const handle = await loginRemote(url, input.username, input.password);
      if (input.action === "test") {
        discardRemoteHandle(handle);
        return Response.json({ url, connected: true });
      }
      discardRemoteSession(request);
      const headers = new Headers();
      headers.append("set-cookie", remoteCookie(request, handle));
      headers.append(
        "set-cookie",
        `${backendCookie(request)}=${encodeURIComponent(url)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${cookieSecurity()}`,
      );
      headers.append(
        "set-cookie",
        `${kindCookie(request)}=remote; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${cookieSecurity()}`,
      );
      return Response.json({ url, connected: true }, { headers });
    }
    const url = localBackend(input.url, new URL(request.url).port);
    let ready = false;
    try {
      const response = await fetch(`${url}/api/runtime`, {
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
      const info = await response.json();
      ready =
        response.ok &&
        info &&
        typeof info.mcp?.connected === "boolean" &&
        "model" in info;
    } catch {
      /* A failed probe must preserve the currently selected backend. */
    }
    if (!ready)
      return Response.json(
        { error: "Could not connect to a Raphie backend at that address." },
        { status: 503 },
      );
    if (input.action === "connect") discardRemoteSession(request);
    const headers = new Headers();
    if (input.action === "connect") {
      headers.append(
        "set-cookie",
        `${backendCookie(request)}=${encodeURIComponent(url)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${cookieSecurity()}`,
      );
      headers.append(
        "set-cookie",
        `${kindCookie(request)}=local; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${cookieSecurity()}`,
      );
    }
    return Response.json({ url, connected: true }, { headers });
  } catch {
    return Response.json(
      {
        error:
          "Could not connect. Check the gateway address and sign-in details.",
      },
      { status: 400 },
    );
  }
}
