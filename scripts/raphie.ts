#!/usr/bin/env bun
import { existsSync, mkdtempSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

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

/** Set by `bun build --define` for a release; a source checkout has none. */
declare const __RAPHIE_VERSION__: string | undefined;

const VERSION =
  typeof __RAPHIE_VERSION__ === "string" ? __RAPHIE_VERSION__ : "development";

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

/** A user installation's background service: a launchd agent or a systemd user unit. */
type Service = {
  running(): boolean;
  start(): boolean;
  stop(): boolean;
  restart(): boolean;
};

/** The background service, when the installer set one up. */
function userService(): Service | undefined {
  const home = process.env.HOME || homedir();
  if (process.platform === "darwin") {
    const domain = `gui/${process.getuid?.()}`;
    const label = `${domain}/com.raphie.user`;
    const agent = join(home, "Library/LaunchAgents/com.raphie.user.plist");
    if (!existsSync(agent)) return undefined;
    return {
      running: () => run(["launchctl", "print", label]),
      // As the installer does: an agent that was disabled stays loadable.
      start: () =>
        run(["launchctl", "enable", label]) &&
        run(["launchctl", "bootstrap", domain, agent]),
      stop: () => run(["launchctl", "bootout", domain, agent]),
      restart: () => run(["launchctl", "kickstart", "-k", label]),
    };
  }
  if (!existsSync(join(home, ".config/systemd/user/raphie.service")))
    return undefined;
  const systemctl = (action: string) =>
    run(["systemctl", "--user", action, "raphie.service"]);
  return {
    running: () =>
      run(["systemctl", "--user", "is-active", "--quiet", "raphie.service"]),
    start: () => systemctl("start"),
    stop: () => systemctl("stop"),
    restart: () => systemctl("restart"),
  };
}

/** The background service, when the installer set one up and it is running. */
function service() {
  const found = userService();
  if (!found?.running()) return undefined;
  return () => found.restart();
}

/** This user installation's folder, or what to use instead. */
function requireUserInstall(command: "stop" | "restart" | "update") {
  const directory = userInstall();
  if (directory) return directory;
  throw new Error(
    command === "update"
      ? "raphie update updates a user installation. For a system installation use sudo raphie update."
      : `raphie ${command} manages a user installation's background service. For a system installation use sudo systemctl ${command} raphie; from a source checkout, use the terminal running raphie start.`,
  );
}

/** `raphie stop`: stops the background service until restart or next login. */
async function stopService() {
  requireUserInstall("stop");
  const found = userService();
  if (!found?.running()) {
    console.log("Raphie's background service is not running.");
    return;
  }
  if (!found.stop())
    throw new Error("Could not stop Raphie's background service.");
  // A stopped service may hold its ports for a moment while it exits.
  const ports = [Number(process.env.PORT), Number(process.env.RAPHIE_WEB_PORT)];
  for (let attempt = 0; attempt < 120; attempt++) {
    if ((await Promise.all(ports.map(portFree))).every(Boolean)) {
      console.log(
        "Raphie stopped. It starts again at your next login, or now with raphie restart.",
      );
      return;
    }
    await Bun.sleep(250);
  }
  throw new Error(
    `Raphie's service stopped, but port ${ports.join(" or ")} is still in use.`,
  );
}

/** `raphie restart`: restarts the background service, or starts a stopped one. */
async function restartService() {
  requireUserInstall("restart");
  const found = userService();
  if (!found)
    throw new Error(
      "This installation has no background service. Run raphie start in a terminal instead.",
    );
  const started = found.running() ? found.restart() : found.start();
  if (!started || !(await healthyWithin(15)))
    throw new Error(
      "Raphie did not answer after restarting. Check raphie status and the service log.",
    );
  console.log(
    `Raphie is running at http://127.0.0.1:${process.env.RAPHIE_WEB_PORT}.`,
  );
}

/** `raphie start` in a terminal: start the background service, or say it runs. */
async function startService(found: Service) {
  const address = `http://127.0.0.1:${process.env.RAPHIE_WEB_PORT}`;
  if (found.running()) {
    console.log(`Raphie is already running in the background at ${address}.`);
    return;
  }
  if (!found.start() || !(await healthyWithin(15)))
    throw new Error(
      "Raphie did not answer after starting. Check raphie status and the service log.",
    );
  console.log(
    `Raphie is running in the background at ${address}.\nStop it with raphie stop, or run it in this terminal with raphie start --foreground.`,
  );
}

/** Where `raphie update` gets the installer: the same one the docs pipe to bash. */
const INSTALLER_URL =
  "https://raw.githubusercontent.com/kalibetre/raphie/main/scripts/install.sh";

/** `raphie update [--channel stable|nightly]`: runs the installer, which updates in place. */
async function update(args: string[]) {
  requireUserInstall("update");
  const [flag, channel, ...rest] = args;
  if (rest.length || (flag !== undefined && (flag !== "--channel" || !channel)))
    throw new Error("Usage: raphie update [--channel stable|nightly]");
  if (channel !== undefined && channel !== "stable" && channel !== "nightly")
    throw new Error("Choose either stable or nightly.");
  const folder = mkdtempSync(join(tmpdir(), "raphie-update-"));
  try {
    const installer = join(folder, "install.sh");
    if (!run(["curl", "-fsSL", INSTALLER_URL, "-o", installer]))
      throw new Error("Could not download the installer. Nothing was changed.");
    // The installer checks the release against SHA256SUMS, backs up the
    // data, stops the service, swaps the binaries and restarts it.
    const child = Bun.spawn(
      ["bash", installer, ...(channel ? ["--channel", channel] : [])],
      {
        stdin: "inherit",
        stdout: "inherit",
        stderr: "inherit",
        env: process.env,
      },
    );
    process.exitCode = await child.exited;
  } finally {
    rmSync(folder, { recursive: true, force: true });
  }
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

/** Set by `bun build --define` in tests, to stand-in roles on disk. */
declare const __RAPHIE_ROLE_ROOT__: string | undefined;

/**
 * A release is one executable: `raphie start` runs the runtime and the web
 * host as two processes of this same file, each told its role by a first
 * argument no one types. They are further entry points built into it, found
 * from its root and loaded by address, so the CLI's own commands start
 * neither and the bundler keeps their module order as it is when each is
 * built alone.
 */
const ROLES = {
  __runtime: "packages/runtime/src/main.js",
  __web: "apps/web/server.js",
} as const;

const roleRoot = () =>
  typeof __RAPHIE_ROLE_ROOT__ === "string"
    ? __RAPHIE_ROLE_ROOT__
    : pathToFileURL(`${dirname(Bun.main)}/`).href;

async function main() {
  const args = process.argv.slice(2);
  const role = args[0];
  if (
    Bun.isStandaloneExecutable &&
    (role === "__runtime" || role === "__web")
  ) {
    await import(new URL(ROLES[role], roleRoot()).href);
    return;
  }
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
  if (command === "--version" && args.length === 1) {
    console.log(`raphie ${VERSION}`);
    return;
  }
  // A user installation runs on the ports it saved, whatever else is set.
  const install = userInstall();
  if (install)
    Object.assign(process.env, portEnvironment(installedPorts(install)));
  if (command === "set-port") return setPort(args.slice(1));
  if (command === "update") return update(args.slice(1));
  let foreground = false;
  if (command === "start" && action === "--foreground") {
    foreground = true;
    args.splice(1, 1);
  }
  // Typed in a terminal, start leaves Raphie running as the background
  // service, as it runs after login. The service runs start itself with no
  // terminal, so it, and --foreground, run Raphie here.
  if (command === "start" && !foreground && install && process.stdin.isTTY) {
    const found = userService();
    if (found) return startService(found);
  }
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
    if (action) console.log("Run raphie update to update now.");
    return;
  }
  if (command === "stop") return stopService();
  if (command === "restart") return restartService();
  if (command === "health") {
    if (!(await installationHealthy(process.env))) process.exitCode = 1;
    return;
  }
  if (command === "start") {
    if (Bun.isStandaloneExecutable) {
      const children: ReturnType<typeof Bun.spawn>[] = [];
      let stopping = false;
      const stop = () => {
        stopping = true;
        for (const child of children) child.kill("SIGTERM");
      };
      process.once("SIGINT", stop);
      process.once("SIGTERM", stop);
      try {
        for (const role of Object.keys(ROLES))
          children.push(
            Bun.spawn([process.execPath, role], {
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
      `Raphie CLI\n\n  raphie start                Start Raphie (in the background on a user install)\n  raphie start --foreground   Run Raphie in this terminal until Ctrl+C\n  raphie status               Check the local runtime\n  raphie stop                 Stop the background service\n  raphie restart              Restart (or start) the background service\n  raphie update [--channel stable|nightly]  Update to the newest release\n  raphie port                 Show the web and runtime ports\n  raphie set-port WEB [--runtime PORT]  Change the ports and restart (default ${DEFAULT_PORTS.web}, runtime ${DEFAULT_PORTS.runtime})\n  raphie channel [stable|nightly]  Show or change the update channel\n  raphie auth setup           Create the administrator (interactive)\n  raphie auth recover         Reset the password and sign every browser out\n  raphie --version            Show the installed version\n\nUse --data-dir PATH to select the data directory for start or auth commands.`,
    );
    return;
  }
  throw new Error("Unknown command. Run raphie --help.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Command failed.");
  process.exitCode = 1;
});
