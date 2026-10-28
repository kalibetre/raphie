import { pairingApi } from "./pairing-api.ts";
import { pairingInstructionsPage } from "./pairing-page.ts";
import type { PairingStore } from "./pairing-store.ts";
import { deviceToken, nativeToken } from "./server-auth.ts";

/** Pairing-only authentication for a single explicitly configured origin. */
export function pairedAuth(devices: PairingStore, origin: string) {
  const expected = new URL(origin);
  if (expected.origin !== origin || expected.username || expected.password)
    throw new Error("Server mode requires an exact origin.");
  const pairing = pairingApi(devices, origin);
  return async (request: Request): Promise<Response | null> => {
    const url = new URL(request.url);
    const suppliedOrigin = request.headers.get("origin");
    if (
      url.host !== expected.host ||
      (suppliedOrigin && suppliedOrigin !== origin)
    )
      return new Response("Unrecognized origin.", { status: 403 });
    const device = deviceToken(request);
    const bearer = nativeToken(request);
    const browser = devices.valid(device);
    const native =
      !suppliedOrigin &&
      !request.headers.has("cookie") &&
      url.pathname.startsWith("/api/") &&
      devices.valid(bearer);
    const result = await pairing(request, browser);
    if (result) return result;
    if (
      !["GET", "HEAD"].includes(request.method) &&
      suppliedOrigin !== origin &&
      !native
    )
      return new Response("Unrecognized origin.", { status: 403 });
    if (url.pathname === "/auth/connect" && request.method === "GET")
      return pairingInstructionsPage();
    if (url.pathname === "/auth/logout" && request.method === "POST") {
      if (browser) devices.revokeCredential(device);
      return new Response(null, {
        status: 303,
        headers: {
          location: "/auth/connect",
          "cache-control": "no-store",
          "set-cookie": `raphie_device=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0${expected.protocol === "https:" ? "; Secure" : ""}`,
        },
      });
    }
    if (browser && url.pathname === "/auth/status" && request.method === "GET")
      return Response.json(
        { enabled: true, pairingEnabled: true },
        { headers: { "cache-control": "no-store" } },
      );
    if (!browser && !native) {
      if (url.pathname.startsWith("/api/"))
        return Response.json(
          { error: "Pairing required." },
          { status: 401, headers: { "cache-control": "no-store" } },
        );
      return new Response(null, {
        status: 303,
        headers: { location: "/auth/connect", "cache-control": "no-store" },
      });
    }
    return null;
  };
}
