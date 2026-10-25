import { expect, test } from "bun:test";

import { ContainerCli } from "../src/domains/workspaces/infrastructure/container-cli.ts";
import {
  decodeWire,
  encodeWire,
} from "../src/domains/workspaces/infrastructure/container-wire.ts";

test("container ownership filtering precedes every inspection or removal", () => {
  const cli = new ContainerCli();
  const calls: string[][] = [];
  cli.run = (args) => {
    calls.push(args);
    if (args[0] === "ps") return "owned-id";
    if (args[0] === "inspect") return '[{"Id":"owned-id"}]';
    return "";
  };
  cli.inspect("bot", "test");
  cli.removeOwned("bot", "test");
  expect(calls).toEqual([
    [
      "ps",
      "-aq",
      "--no-trunc",
      "--filter",
      "label=raphie.workspace=bot",
      "--filter",
      "label=raphie.scope=test",
    ],
    ["inspect", "owned-id"],
    [
      "ps",
      "-aq",
      "--no-trunc",
      "--filter",
      "label=raphie.workspace=bot",
      "--filter",
      "label=raphie.scope=test",
    ],
    ["rm", "-f", "owned-id"],
  ]);
});

test("guest transport preserves binary data and error codes", () => {
  expect(
    decodeWire(
      JSON.parse(
        JSON.stringify(encodeWire({ bytes: Buffer.from([0, 255, 10]) })),
      ),
    ),
  ).toEqual({ bytes: new Uint8Array([0, 255, 10]) });
});
