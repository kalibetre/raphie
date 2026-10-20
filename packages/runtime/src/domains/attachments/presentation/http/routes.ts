import { Hono } from "hono";

import { InputError } from "../../../../shared/application/input-error.ts";
import type { FileApprovalCommands } from "../../../approvals/application/ports.ts";
import type { AttachmentStore } from "../../application/ports.ts";

export function attachmentRoutes(
  store: AttachmentStore,
  approvals: Pick<FileApprovalCommands, "state">,
) {
  return new Hono().get("/files/:id", async (c) => {
    const id = c.req.param("id");
    const file = (await approvals.state()).approvals
      .flatMap((a) => [...a.files, ...a.results])
      .find((f) => f.id === id);
    if (!file) throw new InputError("File not found.", 404);
    c.header("Content-Type", "application/octet-stream");
    c.header(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`,
    );
    return c.body(new Uint8Array(await store.read(id)));
  });
}
