import type { SaveSkill } from "@raphie/contracts";
import { Hono } from "hono";
import { z } from "zod";

import {
  jsonInput,
  limitBody,
} from "../../../../infrastructure/http/validation.ts";
import { InputError } from "../../../../shared/application/input-error.ts";
import { SKILL_LIMITS } from "../../domain/skill.ts";
import { readZip } from "../../infrastructure/archives.ts";
import {
  gitHubFiles,
  gitHubSource,
} from "../../infrastructure/github-skills.ts";
import type { WorkspaceSkills } from "../../infrastructure/workspace-skills.ts";

const ZIP_LIMIT = 8 * 1024 * 1024;

const saveSkill = z
  .object({
    files: z
      .array(
        z
          .object({
            path: z.string().min(1).max(512),
            text: z.string().max(SKILL_LIMITS.bytes),
          })
          .strict(),
      )
      .min(1)
      .max(SKILL_LIMITS.files),
  })
  .strict();

const enabled = z.object({ enabled: z.boolean() }).strict();
const changeQuery = z.object({
  call: z.string().min(1).max(256),
  from: z.coerce.number().int().nonnegative(),
  to: z.coerce.number().int().nonnegative(),
});
const gitHub = z
  .object({ url: z.string().min(1).max(2048), replace: z.boolean() })
  .strict();

/**
 * One bot's skills; owner-only. The bot itself reads them with read_skill
 * and writes them with save_skill, whose changes the owner can undo here.
 */
export function skillRoutes(
  skills: WorkspaceSkills,
  fetchImpl: typeof fetch = fetch,
) {
  const save = (create: boolean) => (name: string, input: SaveSkill) =>
    skills.save(name, input, create);
  return new Hono()
    .get("/", async (c) => c.json({ items: await skills.list() }))
    .post("/import", limitBody(ZIP_LIMIT + 64 * 1024), async (c) => {
      const form = await c.req.formData();
      const file = form.get("file");
      if (!(file instanceof File))
        throw new InputError("Choose a .zip file to import.");
      if (file.size > ZIP_LIMIT)
        throw new InputError("A .zip is at most 8 MiB.", 413);
      const archive = readZip(new Uint8Array(await file.arrayBuffer()));
      const installed = await skills.install(
        archive,
        form.get("replace") === "true",
      );
      return c.json({ installed }, 201);
    })
    .post("/import/github", limitBody(4096), jsonInput(gitHub), async (c) => {
      const { url, replace } = c.req.valid("json");
      const files = await gitHubFiles(gitHubSource(url), fetchImpl);
      const installed = await skills.install(files, replace);
      return c.json({ installed }, 201);
    })
    .get("/changes", async (c) => {
      const parsed = changeQuery.safeParse(c.req.query());
      if (!parsed.success)
        throw new InputError("Name a call, and from and to times.");
      const { call, from, to } = parsed.data;
      return c.json(await skills.changeByCall(call, from, to));
    })
    .get("/changes/:id", async (c) =>
      c.json(await skills.change(c.req.param("id"))),
    )
    .post("/changes/:id/undo", async (c) => {
      await skills.undo(c.req.param("id"));
      return c.json({ items: await skills.list() });
    })
    .get("/:name", async (c) =>
      c.json(await skills.detail(c.req.param("name"))),
    )
    .post(
      "/:name",
      limitBody(SKILL_LIMITS.bytes * 2),
      jsonInput(saveSkill),
      async (c) => {
        await save(true)(c.req.param("name"), c.req.valid("json"));
        return c.json(await skills.detail(c.req.param("name")), 201);
      },
    )
    .put(
      "/:name",
      limitBody(SKILL_LIMITS.bytes * 2),
      jsonInput(saveSkill),
      async (c) => {
        await save(false)(c.req.param("name"), c.req.valid("json"));
        return c.json(await skills.detail(c.req.param("name")));
      },
    )
    .put("/:name/enabled", limitBody(256), jsonInput(enabled), async (c) => {
      await skills.enable(c.req.param("name"), c.req.valid("json").enabled);
      return c.json({ items: await skills.list() });
    })
    .delete("/:name", async (c) => {
      await skills.remove(c.req.param("name"));
      return c.body(null, 204);
    });
}
