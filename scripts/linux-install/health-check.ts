export async function installationHealthy(
  config: Record<string, string | undefined>,
): Promise<boolean> {
  try {
    const runtime = await fetch(
      `http://127.0.0.1:${config.PORT ?? "4316"}/api/runtime`,
      { signal: AbortSignal.timeout(1000) },
    );
    const web = await fetch(
      `http://127.0.0.1:${config.RAPHIE_WEB_PORT}/_raphie/version`,
      { signal: AbortSignal.timeout(1000) },
    );
    return runtime.ok && web.ok && typeof (await web.json()).id === "string";
  } catch {
    return false;
  }
}
