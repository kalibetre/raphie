import { defineExtension, defineTool } from "@earendil-works/pi-durable";
import { bool, obj, opt, str } from "@earendil-works/pi-schema";
import type {
  BotProfile,
  OwnerProfile,
  SaveOwnerProfile,
} from "@raphie/contracts";

import { knownTimeZone } from "../domain/owner.ts";
import { cleanRule, MAX_RULE_LENGTH, MAX_RULES } from "../domain/rules.ts";

/** One bot's view of what it may change about itself and the owner. */
export type SelfProfile = {
  profile(): BotProfile;
  /** Saves a new revision; unchanged text saves nothing. */
  updatePersonality(personality: string): BotProfile;
  /** Saves a new revision; unchanged rules save nothing. */
  updateRules(rules: string[]): BotProfile;
  owner(): OwnerProfile;
  saveOwner(input: SaveOwnerProfile): OwnerProfile;
};

const text = (value: string, isError = false) => ({
  output: [{ type: "text" as const, text: value }],
  isError,
});

/**
 * `update_personality`, `update_owner_profile` and `save_rule`: a bot
 * changing its own personality, what every bot knows about the owner, or
 * the standing rules it and every bot follow. Each is allowed per bot in
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
        name: "save_rule",
        description:
          'Save, change or remove a standing rule: something the owner wants done every time, said with words such as "always", "never" or "from now on". You read your rules in every conversation. Write one short, self-contained sentence. To change or remove a rule, give its current text in replaces; leave rule empty to remove it. everyBot saves it for all of the owner\'s bots, for a rule about the owner and not about your own work.',
        parameters: obj({
          rule: str({ maxLength: MAX_RULE_LENGTH }),
          replaces: opt(str({ maxLength: MAX_RULE_LENGTH })),
          everyBot: opt(bool()),
        }),
        replay: "safe",
        execute: async (args) => {
          const allowed = self.profile().selfUpdates;
          if (args.everyBot && !allowed.owner)
            return text(
              allowed.personality
                ? "The owner has not allowed you to save rules for every bot. Save it for yourself, without everyBot, or tell them they can add it in Settings → You."
                : "The owner has not allowed you to save rules. They can add it in Settings.",
              true,
            );
          if (!args.everyBot && !allowed.personality)
            return text(
              "The owner has not allowed you to change how you work. They can add the rule in Settings → Profile.",
              true,
            );
          const current = args.everyBot
            ? self.owner().rules
            : self.profile().rules;
          const rule = cleanRule(args.rule);
          const replaces = args.replaces && cleanRule(args.replaces);
          if (replaces && !current.includes(replaces))
            return text(
              `No rule reads "${replaces}". The rules are: ${current.length ? current.map((item) => `"${item}"`).join("; ") : "none"}.`,
              true,
            );
          if (!rule && !replaces)
            return text("Say the rule, or which rule to remove.", true);
          if (rule && current.includes(rule) && rule !== replaces)
            return text("That rule is already saved.");
          const next = replaces
            ? current.flatMap((item) =>
                item === replaces ? (rule ? [rule] : []) : [item],
              )
            : [...current, rule];
          if (next.length > MAX_RULES)
            return text(
              `There are already ${MAX_RULES} rules. Replace or remove one first.`,
              true,
            );
          if (args.everyBot) {
            const { updatedAt: _, ...owner } = self.owner();
            self.saveOwner({ ...owner, rules: next });
          } else self.updateRules(next);
          const whose = args.everyBot ? "Every bot reads" : "You read";
          return text(
            rule
              ? `Saved. ${whose} it in every conversation, from the next message.`
              : `Removed. ${whose} the rules without it from the next message.`,
          );
        },
      }),
    ],
  });
}
