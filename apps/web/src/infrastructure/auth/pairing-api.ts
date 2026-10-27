import type { PairingStore } from "./pairing-store.ts";

const maxBody = 4096;
const noStore = {
  "cache-control": "no-store",
  "referrer-policy": "no-referrer",
};

async function readObject(request: Request): Promise<Record<string, unknown>> {
  const length = request.headers.get("content-length");
  if (length && (!/^\d+$/.test(length) || Number(length) > maxBody))
    throw new Error("Invalid body");
  if (!request.body) throw new Error("Missing body");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      size += result.value.length;
      if (size > maxBody) {
        await reader.cancel();
        throw new Error("Body too large");
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }
  const value: unknown = JSON.parse(
    new TextDecoder().decode(Buffer.concat(chunks)),
  );
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid body");
  return value as Record<string, unknown>;
}

/** Unmounted protocol slice. The outer host must authenticate owner actions. */
export function pairingApi(store: PairingStore, origin: string) {
  const expected = new URL(origin);
  if (
    expected.origin !== origin ||
    (expected.protocol !== "https:" &&
      !(
        expected.protocol === "http:" &&
        ["localhost", "127.0.0.1"].includes(expected.hostname)
      ))
  )
    throw new Error("Pairing requires HTTPS or loopback HTTP.");
  let attempts: number[] = [];
  return async (request: Request, owner: boolean): Promise<Response | null> => {
    const url = new URL(request.url);
    if (!url.pathname.startsWith("/auth/pairing/")) return null;
    if (url.host !== expected.host)
      return new Response("Unrecognized host.", {
        status: 403,
        headers: noStore,
      });
    const suppliedOrigin = request.headers.get("origin");
    if (suppliedOrigin && suppliedOrigin !== origin)
      return new Response("Unrecognized origin.", {
        status: 403,
        headers: noStore,
      });
    const json = (value: unknown, status = 200) =>
      Response.json(value, { status, headers: noStore });
    if (request.method === "GET" && url.pathname === "/auth/pairing/devices")
      return owner
        ? json({ devices: store.list() })
        : json({ error: "Sign in required." }, 401);
    if (request.method !== "POST") return json({ error: "Not found." }, 404);
    const nativeRedeem = url.pathname === "/auth/pairing/redeem-native";
    if (
      (!nativeRedeem && suppliedOrigin !== origin) ||
      (nativeRedeem && suppliedOrigin !== null)
    )
      return json({ error: "Unrecognized origin." }, 403);
    if (
      request.headers
        .get("content-type")
        ?.split(";")[0]
        ?.trim()
        .toLowerCase() !== "application/json"
    )
      return json({ error: "JSON required." }, 415);
    if (url.pathname === "/auth/pairing/redeem" || nativeRedeem) {
      const now = Date.now();
      attempts = attempts.filter((at) => at > now - 60_000);
      if (attempts.length >= 10)
        return json({ error: "Please try again later." }, 429);
      attempts.push(now);
      try {
        const input = await readObject(request);
        if (typeof input.secret !== "string" || typeof input.label !== "string")
          return json({ error: "Invalid pairing request." }, 400);
        const device = store.redeem(input.secret, input.label);
        if (!device)
          return json({ error: "Pairing code is invalid or expired." }, 400);
        if (nativeRedeem)
          return json({ id: device.id, credential: device.credential });
        const headers = new Headers(noStore);
        headers.append(
          "set-cookie",
          `raphie_device=${device.credential}; HttpOnly; SameSite=Strict; Path=/${expected.protocol === "https:" ? "; Secure" : ""}`,
        );
        return Response.json({ id: device.id }, { headers });
      } catch {
        return json({ error: "Invalid pairing request." }, 400);
      }
    }
    if (!owner) return json({ error: "Sign in required." }, 401);
    if (url.pathname === "/auth/pairing/create") {
      const code = store.createCode();
      return json({ secret: code.secret, expiresAt: code.expiresAt, origin });
    }
    if (url.pathname === "/auth/pairing/revoke") {
      try {
        const input = await readObject(request);
        if (typeof input.id !== "string" || input.id.length > 80)
          return json({ error: "Invalid device." }, 400);
        return store.revoke(input.id)
          ? json({ revoked: true })
          : json({ error: "Device not found." }, 404);
      } catch {
        return json({ error: "Invalid request." }, 400);
      }
    }
    return json({ error: "Not found." }, 404);
  };
}
