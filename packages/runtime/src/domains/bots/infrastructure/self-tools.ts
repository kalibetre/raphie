import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { bool, obj, opt, str } from "@earendil-works/pi-schema";
import type {
  BotProfile,
  OwnerProfile,
  SaveOwnerProfile,
} from "@raphie/contracts";

import {
  editInstructions,
  MAX_INSTRUCTIONS_LENGTH,
} from "../domain/instructions.ts";
import { knownTimeZone } from "../domain/owner.ts";

/** One bot's view of what it may change about itself and the owner. */
export type SelfProfile = {
  profile(): BotProfile;
  /** Saves a new revision; unchanged text saves nothing. */
  updatePersonality(personality: string): BotProfile;
  /** Saves a new revision; unchanged text saves nothing. */
  updateInstructions(instructions: string): BotProfile;
  owner(): OwnerProfile;
  saveOwner(input: SaveOwnerProfile): OwnerProfile;
};

const text = (value: string, isError = false) => ({
  output: [{ type: "text" as const, text: value }],
  isError,
});

/**
 * `update_personality`, `update_owner_profile` and `update_instructions`:
 * a bot changing its own personality, what every bot knows about the owner,
 * or the instructions it and every bot follow. Each is allowed per bot in
 * its profile; a change is saved at once and the owner can undo it.
 */
export function createSelfTools(self: SelfProfile) {
  return defineExtension({
    name: "raphie.self",
    tools: [
      defineTool({
        name: "update_personality",
        description:
          "Replace your personality with a new version, when the owner asks you to behave differently or you have learned how they like you to work. Send the whole personality, keeping what still applies. It is saved at once as a new revision the owner can undo; tell them what you changed.",
        parameters: obj({
          personality: str({ minLength: 1, maxLength: 16000 }),
        }),
        replay: "safe",
        execute: async (args) => {
          if (!self.profile().selfUpdates.personality)
            return text(
              "The owner has not allowed you to change your personality. They can allow it in Settings → Profile.",
              true,
            );
          const personality = args.personality.trim();
          if (!personality) return text("A personality cannot be empty.", true);
          const saved = self.updatePersonality(personality);
          return text(
            `Saved as revision ${saved.revision}. It applies from your next message.`,
          );
        },
      }),
      defineTool({
        name: "update_owner_profile",
        description:
          "Save what you have learned about the owner: their name, what to call them, their IANA time zone (such as Africa/Addis_Ababa) or a few lines about them. Send only the fields that change. Every bot reads this profile. Save only what the owner told you or clearly confirmed, never guesses.",
        parameters: obj({
          name: opt(str({ maxLength: 80 })),
          callMe: opt(str({ maxLength: 40 })),
          timeZone: opt(str({ maxLength: 64 })),
          about: opt(str({ maxLength: 2000 })),
        }),
        replay: "safe",
        execute: async (args) => {
          if (!self.profile().selfUpdates.owner)
            return text(
              "The owner has not allowed you to update their profile. They can allow it in Settings → Profile.",
              true,
            );
          const timeZone = args.timeZone?.trim();
          if (timeZone && !knownTimeZone(timeZone))
            return text(
              `${timeZone} is not an IANA time zone; use one such as Africa/Addis_Ababa.`,
              true,
            );
          const { updatedAt: _, ...owner } = self.owner();
          const next = {
            name: args.name?.trim() ?? owner.name,
            callMe: args.callMe?.trim() ?? owner.callMe,
            timeZone: timeZone ?? owner.timeZone,
            about: args.about?.trim() ?? owner.about,
          };
          self.saveOwner(next);
          return text("Saved. Every bot sees it from its next message.");
        },
      }),
      defineTool({
        name: "update_instructions",
        description:
          'Change your instructions: what the owner wants done every time, said with words such as "always", "never" or "from now on", and how to work with your tools and services, such as which connection holds their calendar. You read them in every conversation. Make one change: add a line or section at the end; or replace a passage, copied exactly as it reads, with new text (empty removes it); or, only when the owner asks for a rewrite, send the whole text as instructions. everyBot changes the instructions every bot reads instead of your own, for what concerns the owner and every bot rather than your own work. Tell the owner what you changed.',
        parameters: obj({
          add: opt(str({ maxLength: MAX_INSTRUCTIONS_LENGTH })),
          replace: opt(str({ maxLength: MAX_INSTRUCTIONS_LENGTH })),
          with: opt(str({ maxLength: MAX_INSTRUCTIONS_LENGTH })),
          instructions: opt(str({ maxLength: MAX_INSTRUCTIONS_LENGTH })),
          everyBot: opt(bool()),
        }),
        replay: "safe",
        execute: async (args) => {
          const allowed = self.profile().selfUpdates;
          if (args.everyBot ? !allowed.owner : !allowed.personality)
            return text(
              args.everyBot
                ? allowed.personality
                  ? "The owner has not allowed you to change the instructions for every bot. Change your own, without everyBot, or tell them they can change these in Settings → You."
                  : "The owner has not allowed you to change the instructions for every bot. They can change them in Settings → You."
                : "The owner has not allowed you to change how you work. They can change your instructions in Settings → Profile.",
              true,
            );
          const asked = [
            args.add !== undefined && { add: args.add },
            args.replace !== undefined && {
              replace: args.replace,
              with: args.with ?? "",
            },
            args.instructions !== undefined && {
              instructions: args.instructions,
            },
          ].filter((edit) => edit !== false);
          if (asked.length !== 1)
            return text(
              "Make one change: add, replace (with with), or instructions for the whole text.",
              true,
            );
          const current = args.everyBot
            ? self.owner().instructions
            : self.profile().instructions;
          const edited = editInstructions(current, asked[0]!);
          if ("problem" in edited) return text(edited.problem, true);
          if (edited.text === current.trim())
            return text("The instructions already read that way.");
          if (args.everyBot) {
            if (!edited.text)
              return text(
                "The instructions for every bot cannot be emptied by a bot. The owner can reset them in Settings → You.",
                true,
              );
            const { updatedAt: _, ...owner } = self.owner();
            self.saveOwner({ ...owner, instructions: edited.text });
            return text("Saved. Every bot reads them from its next message.");
          }
          const saved = self.updateInstructions(edited.text);
          return text(
            `Saved as revision ${saved.revision}. You read them from your next message.`,
          );
        },
      }),
    ],
  });
}
