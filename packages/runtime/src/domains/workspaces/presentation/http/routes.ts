import type { SandboxSettings, SaveSandboxSettings } from "@raphie/contracts";
import { Hono } from "hono";

import {
  jsonInput,
  limitBody,
} from "../../../../infrastructure/http/validation.ts";
import { InputError } from "../../../../shared/application/input-error.ts";
import type { BotWorkspace } from "../../infrastructure/bot-workspace.ts";
import { saveSandboxSettingsSchema } from "../../infrastructure/sandbox-settings.ts";

/** Outer local-owner middleware and bot routing supply the workspace capability. */
export function workspaceRoutes(
  workspace: BotWorkspace,
  saveSettings: (input: SaveSandboxSettings) => Promise<SandboxSettings>,
) {
  return new Hono()
    .get("/", (c) => c.json(workspace.info()))
    .post(
      "/settings",
      limitBody(4096),
      jsonInput(saveSandboxSettingsSchema),
      async (c) => c.json(await saveSettings(c.req.valid("json"))),
    )
    .get("/files", (c) => c.json(workspace.list(c.req.query("path"))))
    .get("/download", (c) => {
      const raw = c.req.query("revision");
      const revision = Number(raw);
      if (!raw || !/^\d+$/.test(raw) || !Number.isSafeInteger(revision))
        throw new InputError("A workspace revision is required for download.");
      const file = workspace.download(c.req.query("path") ?? "", revision);
      c.header("Content-Type", "application/octet-stream");
      c.header(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      );
      return c.body(new Uint8Array(file.bytes));
    });
}
