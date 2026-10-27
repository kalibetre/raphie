import { randomBytes } from "node:crypto";

type Session = { url: string; cookie: string; expires: number };

const sessions = new Map<string, Session>();
const lifetime = 30 * 24 * 60 * 60 * 1000;

/** HTTP is limited to loopback tunnels and Tailscale's IPv4 address range. */
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
    const match = /^100\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(url.hostname);
    const tailnetIp =
      !!match &&
      Number(match[1]) >= 64 &&
      Number(match[1]) <= 127 &&
      Number(match[2]) <= 255 &&
      Number(match[3]) <= 255;
    if (!tailnetIp && !["127.0.0.1", "localhost"].includes(url.hostname))
      throw new Error(
        "HTTP gateways must use a Tailscale IPv4 address or a loopback tunnel; use HTTPS otherwise.",
      );
  }
  return url.origin;
}

export async function loginRemote(
  url: string,
  username: string,
  password: string,
): Promise<string> {
  if (
    typeof username !== "string" ||
    typeof password !== "string" ||
    !username ||
    username.length > 128 ||
    !password ||
    password.length > 1024
  )
    throw new Error("Enter the gateway username and password.");
  const response = await fetch(`${url}/auth/login`, {
    method: "POST",
    redirect: "manual",
    headers: {
      origin: url,
      "content-type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ username, password }),
    signal: AbortSignal.timeout(8000),
  });
  if (response.status !== 303 || response.headers.get("location") !== "/")
    throw new Error("Gateway sign-in failed.");
  const raw = response.headers
    .getSetCookie()
    .find((value) => value.startsWith("raphie_session="));
  const cookie = raw?.split(";")[0];
  if (!cookie || !/^raphie_session=[A-Za-z0-9_-]{43}$/.test(cookie))
    throw new Error("The gateway did not issue a valid session.");
  const probe = await fetch(`${url}/api/runtime`, {
    headers: { cookie },
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  if (!probe.ok) throw new Error("The gateway is unavailable.");
  for (const [key, value] of sessions)
    if (value.expires <= Date.now()) sessions.delete(key);
  if (sessions.size >= 100)
    throw new Error("Too many gateway sessions; restart the local web server.");
  const handle = randomBytes(32).toString("base64url");
  sessions.set(handle, { url, cookie, expires: Date.now() + lifetime });
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
  return session.cookie;
}

export function discardRemoteHandle(handle: string): void {
  const session = sessions.get(handle);
  if (!session) return;
  sessions.delete(handle);
  void fetch(`${session.url}/auth/logout`, {
    method: "POST",
    headers: { origin: session.url, cookie: session.cookie },
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
