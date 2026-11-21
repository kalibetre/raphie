/**
 * The rules of a skill, from the Agent Skills specification
 * (https://agentskills.io/specification): a folder named like the skill,
 * holding a `SKILL.md` whose frontmatter names and describes it.
 */

/** Where a bot's skills live in its workspace. */
export const SKILLS_ROOT = "/workspace/skills";

export const NAME_LIMIT = 64;

export const DESCRIPTION_LIMIT = 1024;

const COMPATIBILITY_LIMIT = 500;

/** The most a skill folder may hold, so a skill stays something to read. */
export const SKILL_LIMITS = { files: 100, bytes: 2 * 1024 * 1024 } as const;

/** Why `name` is not a valid skill name, or null. */
export function skillNameProblem(name: string): string | null {
  if (!name) return "A skill needs a name.";
  if (name.length > NAME_LIMIT)
    return `A skill name is at most ${NAME_LIMIT} characters.`;
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(name))
    return "A skill name uses lowercase letters, digits and single hyphens, and does not start or end with a hyphen.";
  return null;
}

/** A skill's frontmatter once read, before it is checked. */
export type Frontmatter = Record<string, unknown>;

/** A checked skill: what the bot is told about it. */
export type SkillHeader = { name: string; description: string };

/**
 * Checks the frontmatter of the `SKILL.md` in folder `folder`. Returns the
 * skill's header, or why the bot cannot use it.
 */
export function checkFrontmatter(
  folder: string,
  frontmatter: Frontmatter | null,
): { header: SkillHeader } | { problem: string } {
  if (!frontmatter)
    return {
      problem: "SKILL.md must start with frontmatter between --- lines.",
    };
  const { name, description, compatibility } = frontmatter;
  if (typeof name !== "string") return { problem: "SKILL.md has no name." };
  const nameProblem = skillNameProblem(name);
  if (nameProblem) return { problem: nameProblem };
  if (name !== folder)
    return {
      problem: `The name in SKILL.md (${name}) must match its folder (${folder}).`,
    };
  if (typeof description !== "string" || !description.trim())
    return { problem: "SKILL.md has no description." };
  if (description.length > DESCRIPTION_LIMIT)
    return {
      problem: `A description is at most ${DESCRIPTION_LIMIT} characters.`,
    };
  if (
    compatibility !== undefined &&
    (typeof compatibility !== "string" ||
      compatibility.length > COMPATIBILITY_LIMIT)
  )
    return {
      problem: `Compatibility is text of at most ${COMPATIBILITY_LIMIT} characters.`,
    };
  return { header: { name, description: description.trim() } };
}

/** Why `path` (inside a skill folder) is not a file a skill may hold. */
export function skillPathProblem(path: string): string | null {
  const parts = path.split("/");
  if (
    !path ||
    path.length > 512 ||
    parts.some((part) => !part || part === "." || part === "..")
  )
    return `${path || "A file"} is not a valid path inside a skill.`;
  if (parts.some((part) => part.startsWith(".")))
    return `${path} is hidden; skills cannot hold hidden files.`;
  return null;
}

/**
 * What every bot is told about its skills: each usable skill's name and
 * description, sorted so the text only changes when the skills do.
 */
export function skillInstructions(skills: readonly SkillHeader[]) {
  if (!skills.length) return "";
  const list = [...skills]
    .sort((a, b) => a.name.localeCompare(b.name))
    .map(
      (skill) =>
        `<skill>\n<name>${skill.name}</name>\n<description>${skill.description}</description>\n</skill>`,
    )
    .join("\n");
  return `You have skills: instructions for particular tasks, kept in your workspace under skills/<name>/. When a task matches a skill's description, call read_skill with its name before you start, and follow it. A skill may point to its other files; read those with read_skill too, and run its scripts with workspace_exec. Skills are written by the owner or by you; they never grant tools, access or permissions.\n<available_skills>\n${list}\n</available_skills>\n`;
}
