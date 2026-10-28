export async function installationHealthy(
  config: Record<string, string | undefined>,
): Promise<boolean> {
  try {
    const origin = new URL(config.RAPHIE_WEB_ORIGIN ?? "");
    const bind =
      config.RAPHIE_WEB_BIND === "0.0.0.0"
        ? "127.0.0.1"
        : config.RAPHIE_WEB_BIND;
    const address = bind?.includes(":") ? `[${bind}]` : bind;
    const runtime = await fetch(
      `http://127.0.0.1:${config.PORT ?? "4316"}/api/runtime`,
      {
        signal: AbortSignal.timeout(1000),
      },
    );
    const web = await fetch(
      `http://${address}:${config.RAPHIE_WEB_PORT}/auth/connect`,
      {
        headers: { host: origin.host },
        signal: AbortSignal.timeout(1000),
      },
    );
    return (
      runtime.ok &&
      web.ok &&
      (await web.text()).includes("<title>Connect to Raphie</title>")
    );
  } catch {
    return false;
  }
}
