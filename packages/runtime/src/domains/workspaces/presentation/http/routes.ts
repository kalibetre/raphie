import { Hono } from "hono";

import { InputError } from "../../../../shared/application/input-error.ts";
import type { BotWorkspace } from "../../infrastructure/bot-workspace.ts";

/** Outer local-owner middleware and bot routing supply the workspace capability. */
export function workspaceRoutes(workspace: BotWorkspace) {
  return new Hono()
    .get("/", (c) => c.json(workspace.info()))
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
