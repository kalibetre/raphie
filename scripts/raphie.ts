#!/usr/bin/env bun
import { mkdir } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { Writable } from "node:stream";

import * as qr from "qrcode-terminal";

import { OwnerStore } from "../apps/web/src/infrastructure/auth/owner-store.ts";
import { PairingStore } from "../apps/web/src/infrastructure/auth/pairing-store.ts";

async function prompt(label: string, secret = false): Promise<string> {
  if (!process.stdin.isTTY || !process.stderr.isTTY)
    throw new Error("Account setup requires an interactive terminal.");
  process.stderr.write(label);
  const output = secret
    ? new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      })
    : process.stderr;
  const input = createInterface({
    input: process.stdin,
    output,
    terminal: true,
  });
  try {
    return await input.question("");
  } finally {
    input.close();
    if (secret) process.stderr.write("\n");
  }
}

async function account(action: string) {
  const directory = process.env.DATA_DIRECTORY;
  if (!directory || !isAbsolute(directory))
    throw new Error(
      "Set DATA_DIRECTORY to an absolute installation data directory.",
    );
  await mkdir(resolve(directory), { recursive: true, mode: 0o700 });
  const store = new OwnerStore(resolve(directory, "auth.sqlite"));
  try {
    if (action === "setup" && store.configured())
      throw new Error("Owner account already exists; use auth reset-password.");
    if (action === "reset-password" && !store.configured())
      throw new Error("Owner account is not configured; use auth setup.");
    const username = await prompt("Owner username: ");
    const password = await prompt(
      "Owner password (at least 12 characters): ",
      true,
    );
    const confirmation = await prompt("Confirm password: ", true);
    if (password !== confirmation) throw new Error("Passwords do not match.");
    await store.setOwner(username, password, action === "setup");
    console.log("Owner account saved; existing sessions were revoked.");
  } finally {
    store.close();
  }
}

async function main() {
  const [command, action] = process.argv.slice(2);
  if (command === "pair") {
    if (process.env.RAPHIE_EXPERIMENTAL_PAIRING !== "1")
      throw new Error(
        "Experimental pairing is not enabled for this installation.",
      );
    if (!process.stdout.isTTY)
      throw new Error("Pairing requires an interactive terminal.");
    const directory = process.env.DATA_DIRECTORY;
    if (!directory || !isAbsolute(directory))
      throw new Error(
        "Set DATA_DIRECTORY to an absolute installation data directory.",
      );
    const origin = process.env.RAPHIE_WEB_ORIGIN;
    if (!origin)
      throw new Error("Set RAPHIE_WEB_ORIGIN to the browser-facing origin.");
    const parsed = new URL(origin);
    if (
      parsed.origin !== origin ||
      parsed.username ||
      parsed.password ||
      (parsed.protocol !== "https:" &&
        !(
          parsed.protocol === "http:" &&
          ["localhost", "127.0.0.1"].includes(parsed.hostname)
        ))
    )
      throw new Error(
        "Pairing requires an HTTPS origin or a loopback HTTP tunnel.",
      );
    const store = new PairingStore(resolve(directory, "pairing.sqlite"));
    try {
      const code = store.createCode();
      const link = `${origin}/auth/pairing/page#token=${code.secret}`;
      qr.generate(link, { small: true }, (art) => console.log(art));
      console.log(
        `Pairing link (valid for five minutes, single use):\n${link}\n\nOpen this link only on a device you trust. Anyone with it can pair until it expires.`,
      );
    } finally {
      store.close();
    }
    return;
  }
  if (command === "devices") {
    if (process.env.RAPHIE_EXPERIMENTAL_PAIRING !== "1")
      throw new Error(
        "Experimental pairing is not enabled for this installation.",
      );
    const directory = process.env.DATA_DIRECTORY;
    if (!directory || !isAbsolute(directory))
      throw new Error(
        "Set DATA_DIRECTORY to an absolute installation data directory.",
      );
    const store = new PairingStore(resolve(directory, "pairing.sqlite"));
    try {
      if (action === "list") {
        const devices = store
          .list()
          .filter((device) => device.revoked_at === null);
        if (!devices.length) console.log("No paired devices.");
        for (const device of devices)
          console.log(
            `${device.id}  ${JSON.stringify(device.label)}  last active ${new Date(device.last_used_at).toISOString()}`,
          );
      } else if (action === "revoke") {
        const id = process.argv[4];
        if (!id || !/^[0-9a-f-]{36}$/.test(id) || !store.revoke(id))
          throw new Error("Active device not found.");
        console.log("Device access revoked.");
      } else
        throw new Error(
          "Use raphie devices list or raphie devices revoke <id>.",
        );
    } finally {
      store.close();
    }
    return;
  }
  if (command === "auth" && (action === "setup" || action === "reset-password"))
    return account(action);
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
      "Raphie CLI\n\n  raphie start                Start the web server and runtime\n  raphie status               Check the local runtime\n  raphie pair                 Create an experimental pairing link\n  raphie devices list          List paired devices\n  raphie devices revoke <id>   Revoke a paired device\n  raphie auth setup           Create the server owner account\n  raphie auth reset-password  Reset the owner account and revoke sessions\n\nSet DATA_DIRECTORY to the installation data directory.",
    );
    return;
  }
  throw new Error("Unknown command. Run raphie --help.");
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : "Command failed.");
  process.exitCode = 1;
});
