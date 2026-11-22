import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { obj, opt, str } from "@earendil-works/pi-schema";
import type {
  BotProfile,
  OwnerProfile,
  SaveOwnerProfile,
} from "@raphie/contracts";

import { knownTimeZone } from "../domain/owner.ts";

/** One bot's view of what it may change about itself and the owner. */
export type SelfProfile = {
  profile(): BotProfile;
  /** Saves a new revision; unchanged text saves nothing. */
  updatePersonality(personality: string): BotProfile;
  owner(): OwnerProfile;
  saveOwner(input: SaveOwnerProfile): OwnerProfile;
};

const text = (value: string, isError = false) => ({
  output: [{ type: "text" as const, text: value }],
  isError,
});

/**
 * `update_personality` and `update_owner_profile`: a bot changing its own
 * personality, or what every bot knows about the owner. Each is allowed per
 * bot in its profile; a change is saved at once and the owner can undo it.
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
    ],
  });
}
