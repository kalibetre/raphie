/**
 * The runtime and the web host must both answer. A web host that is locked
 * (no administrator yet) is healthy: it is up and refusing everyone.
 */
export async function installationHealthy(
  config: Record<string, string | undefined>,
): Promise<boolean> {
  try {
    const runtime = await fetch(
      `http://127.0.0.1:${config.PORT ?? "4316"}/api/runtime`,
      { signal: AbortSignal.timeout(1000) },
    );
    const web = await fetch(
      `http://127.0.0.1:${config.RAPHIE_WEB_PORT}/_raphie/health`,
      { signal: AbortSignal.timeout(1000) },
    );
    return (
      runtime.ok &&
      web.ok &&
      ["ready", "locked"].includes((await web.json()).status)
    );
  } catch {
    return false;
  }
}
