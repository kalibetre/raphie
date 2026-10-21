const cookieName = "raphie_backend";

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
  const cookie = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`));
  const value = cookie
    ? decodeURIComponent(cookie.slice(cookieName.length + 1))
    : (process.env.RAPHIE_RUNTIME_URL ?? "http://127.0.0.1:4316");
  return localBackend(value, new URL(request.url).port);
}

/** This endpoint belongs to the web host so an offline backend can be replaced. */
export async function connectionRequest(request: Request) {
  try {
    if (request.method === "GET")
      return Response.json({ url: backendAddress(request) });
    if (request.method !== "POST")
      return Response.json({ error: "Method not allowed." }, { status: 405 });
    if (request.headers.get("x-raphie-client") !== "web")
      return Response.json(
        { error: "Unrecognized request origin." },
        { status: 403 },
      );
    if (Number(request.headers.get("content-length") ?? 0) > 2048)
      throw new Error("Invalid connection request.");
    const text = await request.text();
    if (text.length > 2048) throw new Error("Invalid connection request.");
    const input = JSON.parse(text);
    if (
      typeof input.url !== "string" ||
      !["test", "connect"].includes(input.action)
    )
      throw new Error("Invalid connection request.");
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
    return Response.json(
      { url, connected: true },
      input.action === "connect"
        ? {
            headers: {
              "set-cookie": `${cookieName}=${encodeURIComponent(url)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`,
            },
          }
        : undefined,
    );
  } catch {
    return Response.json(
      {
        error:
          "Use a local HTTP backend address, such as http://127.0.0.1:4316.",
      },
      { status: 400 },
    );
  }
}
