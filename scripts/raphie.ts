#!/usr/bin/env bun
import { statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

import { openAuthService } from "../apps/web/src/infrastructure/auth/auth-service.ts";
import {
  authDirectory,
  webOrigins,
} from "../apps/web/src/infrastructure/auth/auth-storage.ts";
import { installationHealthy } from "./linux-install/health-check.ts";

/** Reads one line from the terminal; hidden input never reaches arguments, logs or history. */
function readLine(label: string, hidden: boolean) {
  if (!process.stdin.isTTY || !process.stdout.isTTY)
    throw new Error("This command needs an interactive terminal.");
  process.stdout.write(label);
  const input = process.stdin;
  input.setRawMode(true);
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
    origins: webOrigins(process.env.RAPHIE_WEB_ORIGIN),
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
  if (
    (command === "auth" && args.length > 2) ||
    (command !== "auth" && args.length > 1)
  )
    throw new Error("Unexpected argument. Run raphie --help.");
  if (command === "start")
    process.env.DATA_DIRECTORY = authDirectory(
      resolve(import.meta.dir, ".."),
      process.env.DATA_DIRECTORY,
      Bun.isStandaloneExecutable,
    );
  if (command === "auth") return authCommand(action);
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
      "Raphie CLI\n\n  raphie start                Start the web server and runtime\n  raphie status               Check the local runtime\n  raphie auth setup           Create the administrator (interactive)\n  raphie auth recover         Reset the password and sign every browser out\n\nUse --data-dir PATH to select the data directory for start or auth commands.",
    );
    return;
  }
  throw new Error("Unknown command. Run raphie --help.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Command failed.");
  process.exitCode = 1;
});
