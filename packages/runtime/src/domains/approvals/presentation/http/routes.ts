import { Hono } from "hono";
import { z } from "zod";

import {
  jsonInput,
  limitBody,
} from "../../../../infrastructure/http/validation.ts";
import { InputError } from "../../../../shared/application/input-error.ts";
import type { AttachmentStore } from "../../../attachments/application/ports.ts";
import { MAX_ATTACHMENT_BYTES } from "../../../attachments/domain/policy.ts";
import type {
  ToolApprovalCommands,
  FileApprovalCommands,
} from "../../application/ports.ts";

const decision = z.object({ decision: z.enum(["approved", "rejected"]) });
const idPattern = /^[a-f0-9-]{36}$/;

export function approvalRoutes(
  tools: ToolApprovalCommands,
  files: FileApprovalCommands,
  attachments: AttachmentStore,
  discordConfigured: boolean,
) {
  const routes = new Hono();
  routes.get("/state", async (c) =>
    c.json({ ...(await files.state()), discordConfigured }),
  );
  routes.post(
    "/tool-approvals/:id",
    limitBody(1024),
    jsonInput(decision),
    async (c) => {
      if (!idPattern.test(c.req.param("id")))
        throw new InputError("Not found.", 404);
      return c.json({
        status: await tools.decide(
          c.req.param("id"),
          c.req.valid("json").decision,
          "owner",
          "web",
        ),
      });
    },
  );
  routes.get("/tool-approvals/:file", async (c) => {
    const file = c.req.param("file");
    const id = file.slice(0, -5);
    if (!file.endsWith(".json") || !idPattern.test(id))
      throw new InputError("Not found.", 404);
    const item = (await tools.state()).approvals.find((a) => a.id === id);
    if (!item) throw new InputError("Tool approval not found.", 404);
    c.header(
      "Content-Disposition",
      `attachment; filename="tool-request-${id}.json"`,
    );
    return c.json({
      server: item.server,
      tool: item.tool,
      arguments: JSON.parse(item.argumentsJson),
    });
  });
  routes.post(
    "/approvals/:id",
    limitBody(1024),
    jsonInput(decision),
    async (c) => {
      if (!idPattern.test(c.req.param("id")))
        throw new InputError("Not found.", 404);
      return c.json({
        status: await files.decide(
          c.req.param("id"),
          c.req.valid("json").decision,
          "owner",
          "web",
        ),
      });
    },
  );
  routes.post(
    "/messages",
    limitBody(MAX_ATTACHMENT_BYTES * 4 + 64 * 1024),
    async (c) => {
      const form = await c.req.formData();
      const uploaded = form.getAll("files");
      if (uploaded.length > 4)
        throw new InputError("Attach at most four files.");
      const saved = [];
      for (const item of uploaded) {
        if (!(item instanceof File))
          throw new InputError("Invalid attachment.");
        if (item.size > MAX_ATTACHMENT_BYTES)
          throw new InputError("Files must be 8 MiB or smaller.", 413);
        saved.push(
          await attachments.put(
            item.name,
            new Uint8Array(await item.arrayBuffer()),
          ),
        );
      }
      const text = form.get("text") ?? "";
      const eventId = form.get("eventId") ?? "";
      if (typeof text !== "string" || typeof eventId !== "string")
        throw new InputError("Invalid message fields.");
      return c.json(
        {
          id: await files.accept({
            source: "web",
            actor: "owner",
            eventId,
            text,
            files: saved,
          }),
        },
        201,
      );
    },
  );
  return routes;
}
