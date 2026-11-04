import { Hono } from "hono";

import { limitBody } from "../../../../infrastructure/http/validation.ts";
import { InputError } from "../../../../shared/application/input-error.ts";
import type { FileApprovalCommands } from "../../../approvals/application/ports.ts";
import type { AttachmentStore } from "../../application/ports.ts";
import { MAX_ATTACHMENT_BYTES } from "../../domain/policy.ts";

export function attachmentRoutes(
  store: AttachmentStore,
  approvals: Pick<FileApprovalCommands, "state">,
) {
  return new Hono()
    .post(
      "/attachments",
      limitBody(MAX_ATTACHMENT_BYTES + 64 * 1024),
      async (c) => {
        const form = await c.req.formData();
        const file = form.get("file");
        if (!(file instanceof File))
          throw new InputError("Choose a file to upload.");
        if (file.size > MAX_ATTACHMENT_BYTES)
          throw new InputError("Files must be 8 MiB or smaller.", 413);
        if (!store.upload)
          throw new InputError("Workspace uploads are unavailable.", 503);
        return c.json(
          await store.upload(
            file.name,
            new Uint8Array(await file.arrayBuffer()),
          ),
          201,
        );
      },
    )
    .get("/files/:id", async (c) => {
      const id = c.req.param("id");
      const legacy = (await approvals.state()).approvals
        .flatMap((a) => [...a.files, ...a.results])
        .find((f) => f.id === id);
      const file =
        legacy ?? (await store.describe?.(id).catch(() => undefined));
      if (!file) throw new InputError("File not found.", 404);
      c.header("Content-Type", "application/octet-stream");
      c.header(
        "Content-Disposition",
        `attachment; filename*=UTF-8''${encodeURIComponent(file.name).replace(/['()*]/g, (ch) => `%${ch.charCodeAt(0).toString(16).toUpperCase()}`)}`,
      );
      return c.body(new Uint8Array(await store.read(id)));
    });
}
