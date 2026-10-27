const config = Object.fromEntries(
  (await Bun.file("/etc/raphie/raphie.conf").text())
    .split("\n")
    .filter((line) => line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1)];
    }),
);
try {
  const origin = new URL(config.RAPHIE_WEB_ORIGIN!);
  const bind =
    config.RAPHIE_WEB_BIND === "0.0.0.0" ? "127.0.0.1" : config.RAPHIE_WEB_BIND;
  const address = bind?.includes(":") ? `[${bind}]` : bind;
  const runtime = await fetch("http://127.0.0.1:4316/api/runtime", {
    signal: AbortSignal.timeout(1000),
  });
  const web = await fetch(
    `http://${address}:${config.RAPHIE_WEB_PORT}/auth/login`,
    { headers: { host: origin.host }, signal: AbortSignal.timeout(1000) },
  );
  if (
    !runtime.ok ||
    !web.ok ||
    !(await web.text()).includes("<title>Sign in · Raphie</title>")
  )
    process.exitCode = 1;
} catch {
  process.exitCode = 1;
}
