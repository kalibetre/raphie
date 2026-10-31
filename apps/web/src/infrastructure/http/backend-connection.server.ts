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
  const value = process.env.RAPHIE_RUNTIME_URL ?? "http://127.0.0.1:4316";
  if (new URL(value).host === new URL(request.url).host)
    throw new Error("Gateway cannot point to this web server.");
  return localBackend(value, new URL(request.url).port);
}
