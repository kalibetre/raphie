import { randomBytes } from "node:crypto";

type Session = { url: string; credential: string; expires: number };

const sessions = new Map<string, Session>();
const lifetime = 30 * 24 * 60 * 60 * 1000;

/** HTTP is limited to loopback tunnels. */
export function remoteAddress(value: string): string {
  const url = new URL(value);
  if (
    url.username ||
    url.password ||
    url.pathname !== "/" ||
    url.search ||
    url.hash ||
    !["http:", "https:"].includes(url.protocol)
  )
    throw new Error("Enter a gateway origin without a path or credentials.");
  if (url.protocol === "http:") {
    if (!["127.0.0.1", "localhost"].includes(url.hostname))
      throw new Error(
        "HTTP gateways require a loopback tunnel; use HTTPS otherwise.",
      );
  }
  return url.origin;
}

export async function loginRemote(url: string, link: string): Promise<string> {
  for (const [key, value] of sessions)
    if (value.expires <= Date.now()) sessions.delete(key);
  if (sessions.size >= 100)
    throw new Error("Too many gateway sessions; restart the local web server.");
  if (typeof link !== "string" || link.length > 2048)
    throw new Error("Enter a pairing link.");
  const pairing = new URL(link);
  const secret = new URLSearchParams(pairing.hash.slice(1)).get("token");
  if (
    pairing.origin !== url ||
    pairing.pathname !== "/auth/pairing/page" ||
    pairing.search ||
    !secret ||
    !/^[A-Za-z0-9_-]{43}$/.test(secret)
  )
    throw new Error("Enter a pairing link for this gateway.");
  const response = await fetch(`${url}/auth/pairing/redeem-native`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ secret, label: "Raphie gateway" }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error("Gateway pairing failed.");
  const body: unknown = await response.json();
  const credential =
    typeof body === "object" && body !== null && "credential" in body
      ? body.credential
      : null;
  if (typeof credential !== "string" || !/^[A-Za-z0-9_-]{43}$/.test(credential))
    throw new Error("The gateway did not issue a valid device credential.");
  try {
    const probe = await fetch(`${url}/api/runtime`, {
      headers: { authorization: `Bearer ${credential}` },
      redirect: "error",
      signal: AbortSignal.timeout(8000),
    });
    if (!probe.ok) throw new Error("The gateway is unavailable.");
  } catch (error) {
    await fetch(`${url}/auth/pairing/revoke-self`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${credential}`,
        "content-type": "application/json",
      },
      body: "{}",
      redirect: "error",
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
    throw error;
  }
  const handle = randomBytes(32).toString("base64url");
  sessions.set(handle, { url, credential, expires: Date.now() + lifetime });
  return handle;
}

export function remoteSession(
  request: Request,
  url: string,
): string | undefined {
  const name = `raphie_remote_${new URL(request.url).port || "80"}=`;
  const handle = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(name))
    ?.slice(name.length);
  const session = handle ? sessions.get(handle) : undefined;
  if (!session || session.url !== url || session.expires <= Date.now())
    return undefined;
  return session.credential;
}

export function validRemoteHandle(
  handle: unknown,
  url: string,
): handle is string {
  if (typeof handle !== "string") return false;
  const session = sessions.get(handle);
  return !!session && session.url === url && session.expires > Date.now();
}

export function discardRemoteHandle(handle: string): void {
  const session = sessions.get(handle);
  if (!session) return;
  sessions.delete(handle);
  void fetch(`${session.url}/auth/pairing/revoke-self`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${session.credential}`,
      "content-type": "application/json",
    },
    body: "{}",
    redirect: "error",
    signal: AbortSignal.timeout(3000),
  }).catch(() => {});
}

export function discardRemoteSession(request: Request): void {
  const name = `raphie_remote_${new URL(request.url).port || "80"}=`;
  const handle = request.headers
    .get("cookie")
    ?.split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(name))
    ?.slice(name.length);
  if (handle) discardRemoteHandle(handle);
}

export function remoteCookie(request: Request, handle: string): string {
  const name = `raphie_remote_${new URL(request.url).port || "80"}`;
  const secure = process.env.RAPHIE_WEB_ORIGIN?.startsWith("https://")
    ? "; Secure"
    : "";
  return `${name}=${handle}; HttpOnly; SameSite=Strict; Path=/${secure}`;
}
