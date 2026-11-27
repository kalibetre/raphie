import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { arr, obj, opt, str } from "@earendil-works/pi-schema";

import {
  inOwnersChat,
  ONLY_IN_OWNERS_CHAT,
} from "../../conversations/infrastructure/owner-chat.ts";
import {
  DESCRIPTION_LIMIT,
  NAME_LIMIT,
  SKILL_LIMITS,
} from "../domain/skill.ts";
import type { WorkspaceSkills } from "./workspace-skills.ts";

const text = (value: string, isError = false) => ({
  output: [{ type: "text" as const, text: value }],
  isError,
});

const message = (error: unknown) =>
  error instanceof Error ? error.message : String(error);

/**
 * `read_skill`: a skill's SKILL.md or one of its files, read without a
 * command, so loading a skill never waits for an approval.
 */
export function createSkillTools(skills: Pick<WorkspaceSkills, "read">) {
  return defineExtension({
    name: "raphie.skills",
    tools: [
      defineTool({
        name: "read_skill",
        description:
          "Read one of your skills: its SKILL.md, or with `path` another text file inside the skill's folder (such as references/guide.md). Use it before a task a skill's description matches.",
        parameters: obj({
          name: str({ minLength: 1, maxLength: 64 }),
          path: opt(str({ minLength: 1, maxLength: 512 })),
        }),
        replay: "safe",
        outputLimits: { maxBytes: 100000, maxLines: 4000 },
        execute: async (args) => {
          try {
            return text(await skills.read(args.name, args.path));
          } catch (error) {
            return text(message(error), true);
          }
        },
      }),
    ],
  });
}

/**
 * `save_skill`: the bot writes a new skill or improves an existing one,
 * checked like the owner's, saved at once and undoable. Allowed per bot.
 */
export function createSkillWriter(
  skills: Pick<WorkspaceSkills, "saveByBot">,
  allowed: () => boolean,
) {
  return defineExtension({
    name: "raphie.skill-writer",
    tools: [
      defineTool({
        name: "save_skill",
        description:
          "Create one of your skills, or replace an existing one's SKILL.md (read it with read_skill first and keep what still applies). `body` is the Markdown after the frontmatter: the steps to follow. `files` adds or replaces other text files in the skill's folder, such as references/guide.md or assets/template.md; files you do not send are kept. It is saved at once, used from your next message, and the owner can undo it.",
        parameters: obj({
          name: str({
            minLength: 1,
            maxLength: NAME_LIMIT,
            description:
              "Lowercase letters, digits and single hyphens, such as release-notes.",
          }),
          description: str({
            minLength: 1,
            maxLength: DESCRIPTION_LIMIT,
            description:
              "What the skill does and when to use it, in one or two sentences.",
          }),
          body: str({ minLength: 1, maxLength: SKILL_LIMITS.bytes }),
          files: opt(
            arr(
              obj({
                path: str({ minLength: 1, maxLength: 512 }),
                text: str({ maxLength: SKILL_LIMITS.bytes }),
              }),
              { maxItems: SKILL_LIMITS.files - 1 },
            ),
          ),
        }),
        replay: "safe",
        execute: async (args, api, ctx) => {
          // A skill lasts and reaches every session: the owner's chat only.
          if (
            !(await api.commit(
              (tx) => inOwnersChat(tx, api.conversationId),
              ctx,
            ))
          )
            return text(ONLY_IN_OWNERS_CHAT, true);
          if (!allowed())
            return text(
              "The owner has not allowed you to write skills. They can allow it in Settings → Profile.",
              true,
            );
          try {
            // Keyed by the call, so the reply can find what this call changed.
            const change = await skills.saveByBot(api.callId, args.name, {
              description: args.description,
              body: args.body,
              ...(args.files ? { files: args.files } : {}),
            });
            if (!change)
              return text(
                `${args.name} already says exactly that; nothing changed.`,
              );
            const verb = change.kind === "created" ? "Created" : "Updated";
            const off = change.enabled
              ? ""
              : " It is turned off, so you will not see it until the owner turns it on.";
            return text(
              `${verb} the skill ${args.name}. It applies from your next message, and the owner can invoke it with /${args.name}.${off}`,
            );
          } catch (error) {
            return text(message(error), true);
          }
        },
      }),
    ],
  });
}
