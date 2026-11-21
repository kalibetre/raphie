import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { obj, opt, str } from "@earendil-works/pi-schema";

import type { WorkspaceSkills } from "./workspace-skills.ts";

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
            const text = await skills.read(args.name, args.path);
            return {
              output: [{ type: "text" as const, text }],
              isError: false,
            };
          } catch (error) {
            return {
              output: [
                {
                  type: "text" as const,
                  text: error instanceof Error ? error.message : String(error),
                },
              ],
              isError: true,
            };
          }
        },
      }),
    ],
  });
}
