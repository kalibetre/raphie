#!/usr/bin/env bun
import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { openAuthService } from "../apps/web/src/infrastructure/auth/auth-service.ts";
import {
  authDirectory,
  webOrigins,
} from "../apps/web/src/infrastructure/auth/auth-storage.ts";
import { installationHealthy } from "./linux-install/health-check.ts";
import { userInstallChannel } from "./user-install-channel.ts";
import {
  DEFAULT_PORTS,
  LEGACY_PORTS,
  parsePort,
  portEnvironment,
  portFree,
  type Ports,
  readUserInstallPorts,
  writeUserInstallPorts,
} from "./user-install-ports.ts";

/** A user installation's folder, or `undefined` for any other copy. */
function userInstall() {
  if (!Bun.isStandaloneExecutable) return undefined;
  const directory = dirname(process.execPath);
  try {
    if (!statSync(join(directory, ".raphie-user-install")).isFile())
      return undefined;
  } catch {
    return undefined;
  }
  return directory;
}

/** The ports a user installation runs on: saved, or the old fixed pair. */
function installedPorts(directory: string): Ports {
  return readUserInstallPorts(directory) ?? LEGACY_PORTS;
}

const run = (command: string[]) =>
  Bun.spawnSync(command, { stdout: "ignore", stderr: "ignore" }).exitCode === 0;

/** The background service, when the installer set one up and it is loaded. */
function service() {
  if (process.platform === "darwin") {
    const label = `gui/${process.getuid?.()}/com.raphie.user`;
    if (!run(["launchctl", "print", label])) return undefined;
    return () => run(["launchctl", "kickstart", "-k", label]);
  }
  if (!run(["systemctl", "--user", "is-active", "--quiet", "raphie.service"]))
    return undefined;
  return () => run(["systemctl", "--user", "restart", "raphie.service"]);
}

async function healthyWithin(seconds: number) {
  for (let attempt = 0; attempt < seconds; attempt++) {
    if (await installationHealthy(process.env)) return true;
    await Bun.sleep(1000);
  }
  return false;
}

/** `raphie set-port WEB [--runtime PORT]`: saves the ports and restarts. */
async function setPort(args: string[]) {
  const directory = userInstall();
  if (!directory)
    throw new Error(
      "raphie set-port changes a user installation. For a system installation use sudo raphie set-port.",
    );
  const [web, flag, runtime, ...rest] = args;
  if (!web || rest.length || (flag !== undefined && flag !== "--runtime"))
    throw new Error("Usage: raphie set-port WEB_PORT [--runtime PORT]");
  const current = installedPorts(directory);
  const next: Ports = {
    web: parsePort(web, "The web port"),
    runtime:
      flag === undefined
        ? current.runtime
        : parsePort(runtime, "The runtime port"),
  };
  if (next.web === next.runtime)
    throw new Error("The web and runtime ports must differ.");
  for (const port of [next.web, next.runtime]) {
    const ours = port === current.web || port === current.runtime;
    if (!ours && !(await portFree(port)))
      throw new Error(`Port ${port} is in use. Choose another.`);
  }
  writeUserInstallPorts(directory, next);
  const restart = service();
  if (!restart) {
    console.log(
      `Saved. Raphie will use http://127.0.0.1:${next.web} (runtime ${next.runtime}) the next time it starts.`,
    );
    return;
  }
  Object.assign(process.env, portEnvironment(next));
  if (restart() && (await healthyWithin(15))) {
    console.log(
      `Raphie restarted on http://127.0.0.1:${next.web} (runtime ${next.runtime}).`,
    );
    console.log(
      "Update anything that points at the old port, such as tailscale serve or the desktop app.",
    );
    return;
  }
  // Put the old ports back so Raphie keeps working.
  writeUserInstallPorts(directory, current);
  Object.assign(process.env, portEnvironment(current));
  restart();
  throw new Error(
    `Raphie did not start on the new ports, so the old ones (web ${current.web}, runtime ${current.runtime}) were put back.`,
  );
}

/** Reads one line from the terminal; hidden input never reaches arguments, logs or history. */
function readLine(label: string, hidden: boolean) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("This command needs an interactive terminal.");
  const input = process.stdin;
  input.setRawMode(true);
  process.stdout.write(label);
  input.setEncoding("utf8");
  input.resume();
  return new Promise<string>((resolve, reject) => {
    let value = "";
    const finish = (settle: () => void) => {
      input.off("data", onData);
      input.setRawMode(false);
      input.pause();
      process.stdout.write("\n");
      settle();
    };
    const onData = (chunk: string) => {
      for (const character of chunk) {
        if (character === "\r" || character === "\n")
          return finish(() => resolve(value));
        if (character === "\u0003")
          return finish(() => reject(new Error("Cancelled.")));
        if (character === "\u007f" || character === "\b") {
          if (value && !hidden) process.stdout.write("\b \b");
          value = Array.from(value).slice(0, -1).join("");
        } else if (character >= " ") {
          value += character;
          if (!hidden) process.stdout.write(character);
        }
      }
    };
    input.on("data", onData);
  });
}

async function authCommand(action: string | undefined) {
  if (action !== "setup" && action !== "recover")
    throw new Error("Use `raphie auth setup` or `raphie auth recover`.");
  const directory = authDirectory(
    resolve(import.meta.dir, ".."),
    process.env.DATA_DIRECTORY,
    Bun.isStandaloneExecutable,
  );
  // Files created by another account would be unreadable to the service.
  try {
    if (statSync(directory).uid !== process.getuid?.())
      throw new Error(
        "Run this command as the account that owns the data directory (the service user).",
      );
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const email =
    action === "setup"
      ? (await readLine("Administrator email: ", false)).trim()
      : "";
  const password = await readLine("New password (12+ characters): ", true);
  if (password !== (await readLine("Repeat password: ", true)))
    throw new Error("The passwords do not match.");
  const service = await openAuthService({
    directory,
    origins: webOrigins(
      process.env.RAPHIE_WEB_ORIGIN,
      Number(process.env.RAPHIE_WEB_PORT ?? 4320),
      process.env.RAPHIE_WEB_ALLOWED_ORIGINS,
    ),
    role: "admin",
  });
  try {
    if (action === "setup") {
      await service.setup(email, password);
      console.log("Administrator created. Sign in at your Raphie address.");
    } else {
      await service.recover(password);
      console.log("Password changed. Every browser has been signed out.");
    }
  } finally {
    service.close();
  }
}

async function main() {
  const args = process.argv.slice(2);
  const flag = args.indexOf("--data-dir");
  if (flag !== -1) {
    const value = args[flag + 1];
    if (
      !value ||
      value.startsWith("--") ||
      args.indexOf("--data-dir", flag + 1) !== -1
    )
      throw new Error("Provide one directory after --data-dir.");
    process.env.DATA_DIRECTORY = resolve(value);
    args.splice(flag, 2);
  }
  const [command, action] = args;
  // A user installation runs on the ports it saved, whatever else is set.
  const install = userInstall();
  if (install)
    Object.assign(process.env, portEnvironment(installedPorts(install)));
  if (command === "set-port") return setPort(args.slice(1));
  if (
    ((command === "auth" || command === "channel") && args.length > 2) ||
    (command !== "auth" && command !== "channel" && args.length > 1)
  )
    throw new Error("Unexpected argument. Run raphie --help.");
  if (command === "port") {
    const web = process.env.RAPHIE_WEB_PORT ?? String(LEGACY_PORTS.web);
    console.log(`Web: http://127.0.0.1:${web}`);
    console.log(`Runtime: ${process.env.PORT ?? LEGACY_PORTS.runtime}`);
    return;
  }
  if (command === "start")
    process.env.DATA_DIRECTORY = authDirectory(
      resolve(import.meta.dir, ".."),
      process.env.DATA_DIRECTORY,
      Bun.isStandaloneExecutable,
    );
  if (command === "auth") return authCommand(action);
  if (command === "channel") {
    if (!Bun.isStandaloneExecutable)
      throw new Error(
        "Release channels are available for a user installation only.",
      );
    const channel = userInstallChannel(dirname(process.execPath), action);
    console.log(`Release channel: ${channel}`);
    if (action) console.log("Run the installer again to check for an update.");
    return;
  }
  if (command === "health") {
    if (!(await installationHealthy(process.env))) process.exitCode = 1;
    return;
  }
  if (command === "start") {
    if (Bun.isStandaloneExecutable) {
      const directory = dirname(process.execPath);
      const children: ReturnType<typeof Bun.spawn>[] = [];
      let stopping = false;
      const stop = () => {
        stopping = true;
        for (const child of children) child.kill("SIGTERM");
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      try {
        for (const executable of ["raphie-runtime", "raphie-web"])
          children.push(
            Bun.spawn([join(directory, executable)], {
              stdin: "inherit",
              stdout: "inherit",
              stderr: "inherit",
              env: process.env,
            }),
          );
        const exit = await Promise.race(children.map((child) => child.exited));
        const interrupted = stopping;
        stop();
        await Promise.all(children.map((child) => child.exited));
        process.exitCode = interrupted ? 0 : exit || 1;
      } finally {
        stop();
        process.off("SIGINT", stop);
        process.off("SIGTERM", stop);
      }
      return;
    }
    const child = Bun.spawn([process.execPath, "run", "start"], {
      cwd: resolve(import.meta.dir, ".."),
      stdin: "inherit",
      stdout: "inherit",
      stderr: "inherit",
      env: process.env,
    });
    const stop = () => child.kill("SIGTERM");
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    const code = await child.exited;
    process.exitCode = code;
    return;
  }
  if (command === "status") {
    try {
      const response = await fetch(
        `http://127.0.0.1:${process.env.PORT ?? "4316"}/api/runtime`,
        { signal: AbortSignal.timeout(3000) },
      );
      if (response.ok) {
        const info = (await response.json()) as {
          identity?: { directory?: string; id?: string };
        };
        console.log("Raphie runtime is responding.");
        if (info.identity?.directory)
          console.log(`Data: ${info.identity.directory}`);
        if (info.identity?.id) console.log(`Workspace: ${info.identity.id}`);
      } else console.log(`Raphie runtime returned HTTP ${response.status}.`);
      if (!response.ok) process.exitCode = 1;
    } catch {
      console.error("Raphie runtime is unavailable.");
      process.exitCode = 1;
    }
    return;
  }
  if (!command || command === "help" || command === "--help") {
    console.log(
      `Raphie CLI\n\n  raphie start                Start the web server and runtime\n  raphie status               Check the local runtime\n  raphie port                 Show the web and runtime ports\n  raphie set-port WEB [--runtime PORT]  Change the ports and restart (default ${DEFAULT_PORTS.web}, runtime ${DEFAULT_PORTS.runtime})\n  raphie channel [stable|nightly]  Show or change the update channel\n  raphie auth setup           Create the administrator (interactive)\n  raphie auth recover         Reset the password and sign every browser out\n\nUse --data-dir PATH to select the data directory for start or auth commands.`,
    );
    return;
  }
  throw new Error("Unknown command. Run raphie --help.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Command failed.");
  process.exitCode = 1;
});
