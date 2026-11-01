/** Exact browser origins accepted by the web host and runtime. */
export function webOrigins(
  configured = "http://127.0.0.1:4320",
  localPort = 4320,
  additional = "",
) {
  const values = [configured, ...(additional ? additional.split(",") : [])];
  const origins: string[] = [];
  for (const value of values) {
    const url = new URL(value);
    if (url.origin !== value || url.username || url.password)
      throw new Error("Browser origins must be exact origins without paths.");
    if (
      url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost"].includes(url.hostname)
      )
    )
      throw new Error("Use HTTPS for a non-loopback web origin.");
    origins.push(url.origin);
    if (["127.0.0.1", "localhost"].includes(url.hostname)) {
      url.hostname = url.hostname === "localhost" ? "127.0.0.1" : "localhost";
      origins.push(url.origin);
    }
  }
  if (values.some((value) => new URL(value).protocol === "https:"))
    origins.push(
      `http://127.0.0.1:${localPort}`,
      `http://localhost:${localPort}`,
    );
  const unique = [...new Set(origins)];
  const hosts = unique.map((origin) => new URL(origin).host);
  if (new Set(hosts).size !== hosts.length)
    throw new Error(
      "Browser origins cannot share a host and port across schemes.",
    );
  return unique;
}
