/** Disposable first-party device client. The access token stays in memory. */
const address = process.argv[2] ?? "http://127.0.0.1:4320";
const url = new URL(address);
if (
  url.origin !== address ||
  url.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(url.hostname) ||
  url.username ||
  url.password
)
  throw new Error(
    "Use an exact loopback HTTP origin, for example http://127.0.0.1:4320.",
  );

const clientId = "raphie-native";
const post = (path: string, body: unknown) =>
  fetch(new URL(path, url), {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "user-agent": "Raphie test client",
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10000),
  });
const issued = await post("/api/auth/device/code", { client_id: clientId });
if (!issued.ok) throw new Error(`Device request failed (${issued.status}).`);
const code = (await issued.json()) as {
  device_code: string;
  user_code: string;
  verification_uri_complete: string;
  interval: number;
  expires_in: number;
};
const verification = new URL(code.verification_uri_complete);
if (
  verification.protocol !== "http:" ||
  !["127.0.0.1", "localhost"].includes(verification.hostname) ||
  verification.port !== url.port ||
  verification.pathname !== "/device"
)
  throw new Error("The server returned an unexpected verification address.");
console.log(`Open ${code.verification_uri_complete}`);
console.log(`Check that the code on the page matches: ${code.user_code}`);
const deadline = Date.now() + code.expires_in * 1000;
let interval = Math.max(code.interval, 5);
while (Date.now() < deadline) {
  await new Promise((resolve) => setTimeout(resolve, interval * 1000));
  const response = await post("/api/auth/device/token", {
    client_id: clientId,
    device_code: code.device_code,
    grant_type: "urn:ietf:params:oauth:grant-type:device_code",
  });
  const result = (await response.json()) as {
    access_token?: string;
    error?: string;
  };
  if (response.ok && result.access_token) {
    const runtime = await fetch(new URL("/api/runtime", url), {
      headers: {
        authorization: `Bearer ${result.access_token}`,
        "x-raphie-client": "web",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (!runtime.ok)
      throw new Error(
        `Device authorization succeeded but the runtime check failed (${runtime.status}).`,
      );
    console.log(
      "Device authorized and runtime access verified. The token was not saved.",
    );
    process.exit(0);
  }
  if (result.error === "slow_down") interval += 5;
  else if (result.error !== "authorization_pending")
    throw new Error("Device authorization was denied, expired, or failed.");
}
throw new Error("Device authorization expired.");
