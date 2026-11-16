import {
  mkdirSync,
  readFileSync,
  renameSync,
  rmdirSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";

/** The two local ports of a user installation. Both bind to loopback only. */
export type Ports = { runtime: number; web: number };

/**
 * New installations. High enough to stay clear of common development
 * servers, and below 32768, where Linux and macOS hand out temporary ports.
 * A source checkout keeps 4316/4320, so both can run side by side.
 */
export const DEFAULT_PORTS: Ports = { runtime: 24316, web: 24320 };

/** Installations made before ports were saved used these. */
export const LEGACY_PORTS: Ports = { runtime: 4316, web: 4320 };

/** A port Raphie may use: unprivileged, so no sudo is needed. */
export function parsePort(value: string | undefined, label = "Port"): number {
  const port = Number(value);
  if (!value || !/^\d+$/.test(value) || port < 1024 || port > 65535)
    throw new Error(`${label} must be a number from 1024 to 65535.`);
  return port;
}

function validate(ports: Ports): Ports {
  if (ports.runtime === ports.web)
    throw new Error("The web and runtime ports must differ.");
  return ports;
}

const file = (directory: string) => join(directory, ".ports");

/** The saved ports, or `undefined` for an installation that predates them. */
export function readUserInstallPorts(directory: string): Ports | undefined {
  let text: string;
  try {
    text = readFileSync(file(directory), "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
    throw error;
  }
  const values = new Map(
    text
      .split("\n")
      .filter(Boolean)
      .map((line) => line.split("=", 2) as [string, string]),
  );
  try {
    return validate({
      runtime: parsePort(values.get("runtime")),
      web: parsePort(values.get("web")),
    });
  } catch {
    throw new Error(
      `${file(directory)} is not valid. Fix it with raphie set-port.`,
    );
  }
}

/** Saves `ports`, under the installer's lock so an update can't race it. */
export function writeUserInstallPorts(directory: string, ports: Ports) {
  validate(ports);
  const lock = join(dirname(directory), ".raphie-install.lock");
  try {
    mkdirSync(lock, { mode: 0o700 });
  } catch {
    throw new Error("Another Raphie installation or update is in progress.");
  }
  const temporary = `${file(directory)}.${process.pid}.${crypto.randomUUID()}`;
  try {
    writeFileSync(temporary, `runtime=${ports.runtime}\nweb=${ports.web}\n`, {
      flag: "wx",
      mode: 0o600,
    });
    renameSync(temporary, file(directory));
  } finally {
    try {
      unlinkSync(temporary);
    } catch {
      /* Already renamed. */
    }
    rmdirSync(lock);
  }
}

/** What the runtime and web host read to find each other. */
export function portEnvironment(ports: Ports): Record<string, string> {
  return {
    PORT: String(ports.runtime),
    RAPHIE_WEB_PORT: String(ports.web),
    RAPHIE_RUNTIME_URL: `http://127.0.0.1:${ports.runtime}`,
    RAPHIE_WEB_ORIGIN: `http://127.0.0.1:${ports.web}`,
  };
}

/** Whether nothing listens on `port` on loopback. */
export async function portFree(port: number): Promise<boolean> {
  try {
    const server = Bun.listen({
      hostname: "127.0.0.1",
      port,
      socket: { data() {} },
    });
    server.stop(true);
    return true;
  } catch {
    return false;
  }
}
