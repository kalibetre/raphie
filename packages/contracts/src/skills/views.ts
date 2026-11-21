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
};

export type SkillList = { items: SkillSummary[] };

/** A file of a skill as the editor shows it. Binary files have no text. */
export type SkillFile = { path: string; bytes: number; text: string | null };

export type SkillDetail = SkillSummary & { contents: SkillFile[] };

/** The editor's save: the skill's text files, replacing the folder's text files. */
export type SaveSkill = { files: { path: string; text: string }[] };

/** What an import installed. */
export type SkillImport = { installed: string[] };
