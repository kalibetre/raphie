/**
 * A bot's skills: standard Agent Skills (https://agentskills.io) kept in its
 * workspace at `skills/<name>/SKILL.md`, with any bundled files beside it.
 */

/** One skill as Settings lists it. */
export type SkillSummary = {
  /** The folder name, which the frontmatter `name` must match. */
  name: string;
  /** What the skill does and when to use it, from the frontmatter. */
  description: string;
  /** Off skills stay in the workspace but are not offered to the bot. */
  enabled: boolean;
  /** Paths inside the skill folder, `SKILL.md` first. */
  files: string[];
  /** Why the bot cannot use it ("SKILL.md has no description"), or null. */
  problem: string | null;
  /** The bot's last change to it with save_skill, unless the owner has saved it since. */
  botChange: { kind: SkillChangeKind; at: number } | null;
};

export type SkillList = { items: SkillSummary[] };

/** A file of a skill as the editor shows it. Binary files have no text. */
export type SkillFile = { path: string; bytes: number; text: string | null };

export type SkillDetail = SkillSummary & { contents: SkillFile[] };

/** The editor's save: the skill's text files, replacing the folder's text files. */
export type SaveSkill = { files: { path: string; text: string }[] };

/** What an import installed. */
export type SkillImport = { installed: string[] };

export type SkillChangeKind = "created" | "edited";

/**
 * A change the bot made to a skill with save_skill, as its reply shows it.
 * `undoable` while the skill is still as the bot left it, no later change
 * was made and the owner has not saved it since.
 */
export type SkillChange = {
  id: string;
  /** The save_skill call that made it, as the reply's step names it. */
  callId: string;
  name: string;
  kind: SkillChangeKind;
  at: number;
  undoable: boolean;
  /** The owner undid it. */
  undone: boolean;
};
