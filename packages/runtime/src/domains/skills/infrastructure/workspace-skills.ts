import { createHash } from "node:crypto";

import type {
  SaveSkill,
  SkillChange,
  SkillChangeKind,
  SkillDetail,
  SkillFile,
  SkillSummary,
  WorkspaceListing,
} from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import {
  checkFrontmatter,
  type Frontmatter,
  invokedInstructions,
  invokedSkill,
  SKILL_LIMITS,
  skillAuthoringInstructions,
  type SkillHeader,
  skillInstructions,
  skillNameProblem,
  skillPathProblem,
  SKILLS_ROOT,
} from "../domain/skill.ts";
import type { ArchiveFiles } from "./archives.ts";

/** The parts of a bot's workspace the skills need. */
export type SkillFiles = {
  list(path?: string): Promise<WorkspaceListing>;
  download(
    path: string,
    revision: number,
  ): Promise<{ name: string; bytes: Uint8Array }>;
  replaceTree(
    directory: string,
    files: readonly { path: string; bytes: Uint8Array }[] | null,
  ): Promise<void>;
  metadata(key: string): string | null;
  setMetadata(key: string, value: string): void;
};

const DISABLED_KEY = "disabled_skills";
const CHANGES_KEY = "skill_changes";
/** How far a change may be from its call's observed run and still match. */
const CALL_SLACK = 2000;
/** How many of the bot's changes are remembered, for badges and undo. */
const CHANGE_LIMIT = 200;
/** Text past this is not shown in the editor or handed to the model at once. */
const TEXT_LIMIT = 256 * 1024;

type Found = SkillSummary & { header: SkillHeader | null };

type TextFile = { path: string; text: string };

/**
 * A change the bot made with save_skill, kept beside the workspace so the
 * bot cannot rewrite it. Only a skill's latest change keeps what the skill
 * was before it, since only that one can be undone.
 */
type StoredChange = {
  id: string;
  /**
   * The tool call that made it. A provider's call ids need not be unique,
   * so the reply finds it by this and the time it was made.
   */
  callId: string;
  name: string;
  kind: SkillChangeKind;
  at: number;
  /** The skill's text files before; null when the bot created it. */
  before: TextFile[] | null;
  /** A hash of the text files it saved, to tell whether they changed since. */
  after: string;
  /** Set once the owner undid it; it stays for the reply to say so. */
  undone?: true;
};

/** What the bot sends to save_skill. */
export type BotSkill = {
  description: string;
  body: string;
  files?: readonly TextFile[];
};

/** A bot's skills, read from and written to `skills/` in its workspace. */
export class WorkspaceSkills {
  private cached = "";

  private readonly files: SkillFiles;

  constructor(files: SkillFiles) {
    this.files = files;
  }

  /**
   * The skills section of the bot's instructions, as last refreshed, and
   * with `canWrite` how to write its own.
   */
  instructions(canWrite = false) {
    return this.cached + (canWrite ? skillAuthoringInstructions() : "");
  }

  /** Reads the skills again for the instructions. Never throws. */
  async refresh() {
    try {
      const skills = await this.scan();
      this.cached = skillInstructions(
        skills.flatMap((skill) =>
          skill.enabled && skill.header ? [skill.header] : [],
        ),
      );
    } catch {
      // A workspace that cannot be read keeps the skills it last showed.
    }
    return this.cached;
  }

  /**
   * When `text` starts with `/name` for one of this bot's usable skills
   * that is on, the text that loads it for the turn. Undefined otherwise,
   * so `/tmp`, unknown names and skills turned off stay plain text.
   */
  async invoke(text: string): Promise<string | undefined> {
    const name = invokedSkill(text);
    if (!name) return undefined;
    try {
      const skill = (await this.scan()).find((item) => item.name === name);
      if (!skill?.header || !skill.enabled) return undefined;
      const body = asText(
        await this.download(`${SKILLS_ROOT}/${name}/SKILL.md`),
      );
      return body ? invokedInstructions(name, body) : undefined;
    } catch {
      return undefined;
    }
  }

  async list(): Promise<SkillSummary[]> {
    return (await this.scan()).map(({ header: _, ...summary }) => summary);
  }

  /**
   * The bot creates or edits skill `name`: SKILL.md from `skill`, plus any
   * other text files it sends. Files it does not send are kept. Returns the
   * change, or null when nothing changed.
   */
  async saveByBot(callId: string, name: string, skill: BotSkill) {
    const nameProblem = skillNameProblem(name);
    if (nameProblem) throw new InputError(nameProblem);
    for (const file of skill.files ?? [])
      if (file.path === "SKILL.md")
        throw new InputError(
          "Send SKILL.md as description and body, not as a file.",
        );
    const existing = (await this.scan()).find((item) => item.name === name);
    const files = existing
      ? await this.contents(name, existing.files)
      : new Map();
    const before = existing ? textFiles(files) : null;
    const previous = files.get("SKILL.md");
    files.set(
      "SKILL.md",
      new TextEncoder().encode(
        skillMarkdown(
          name,
          skill.description.trim(),
          skill.body,
          previous ? frontmatter(asText(previous) ?? "") : null,
        ),
      ),
    );
    for (const file of skill.files ?? [])
      files.set(file.path, new TextEncoder().encode(file.text));
    const after = hashText(textFiles(files));
    if (before && hashText(before) === after) return null;
    await this.write(name, files, false);
    const change: StoredChange = {
      id: crypto.randomUUID(),
      callId,
      name,
      kind: existing ? "edited" : "created",
      at: Date.now(),
      before,
      after,
    };
    const changes = this.changes().map((item) =>
      item.name === name ? { ...item, before: null } : item,
    );
    this.saveChanges([...changes, change]);
    return { ...this.view(change), enabled: existing?.enabled ?? true };
  }

  /** One of the bot's changes. */
  async change(id: string): Promise<SkillChange> {
    return this.shown(this.changes().find((item) => item.id === id));
  }

  /**
   * The change save_skill call `callId` made while it ran, from `from` to
   * `to`, for the note in the reply that made it. The times are when the
   * reply saw the call start and settle, so a change a little outside them
   * counts; of several, the closest wins.
   */
  async changeByCall(callId: string, from: number, to: number) {
    const distance = (at: number) =>
      at < from ? from - at : at > to ? at - to : 0;
    const found = this.changes()
      .filter(
        (item) => item.callId === callId && distance(item.at) <= CALL_SLACK,
      )
      .sort((a, b) => distance(a.at) - distance(b.at))[0];
    return this.shown(found);
  }

  private async shown(change: StoredChange | undefined) {
    if (!change) throw new InputError("That change is no longer kept.", 404);
    return this.view(change, await this.currentHash(change.name));
  }

  /**
   * Puts a skill back as it was before the bot's change: a skill it created
   * is deleted, an edited one gets its earlier text files back.
   */
  async undo(id: string) {
    const change = await this.change(id);
    if (!change.undoable)
      throw new InputError(
        "This skill has changed since, so the change cannot be undone.",
        409,
      );
    const stored = this.changes().find((item) => item.id === id)!;
    if (!stored.before) {
      await this.files.replaceTree(`${SKILLS_ROOT}/${change.name}`, null);
      this.setEnabled(change.name, true);
    } else {
      const skill = await this.find(change.name);
      const files = new Map<string, Uint8Array>();
      for (const [path, bytes] of await this.contents(change.name, skill.files))
        if (asText(bytes) === null) files.set(path, bytes);
      for (const file of stored.before)
        files.set(file.path, new TextEncoder().encode(file.text));
      await this.write(change.name, files, false);
    }
    this.saveChanges(
      this.changes().map((item) =>
        item.id === id ? { ...item, before: null, undone: true } : item,
      ),
    );
    await this.refresh();
  }

  async detail(name: string): Promise<SkillDetail> {
    const skill = await this.find(name);
    const contents: SkillFile[] = [];
    for (const path of skill.files) {
      const bytes = await this.download(`${SKILLS_ROOT}/${name}/${path}`);
      contents.push({ path, bytes: bytes.length, text: asText(bytes) });
    }
    const { header: _, ...summary } = skill;
    return { ...summary, contents };
  }

  /**
   * One file of an enabled skill for the model: `SKILL.md` unless `path`
   * names another.
   */
  async read(name: string, path?: string): Promise<string> {
    const skill = await this.find(name);
    if (!skill.enabled)
      throw new InputError(`The skill ${name} is turned off.`, 409);
    const file = path ?? "SKILL.md";
    if (!skill.files.includes(file))
      throw new InputError(
        `${name} has no file ${file}. Its files: ${skill.files.join(", ")}.`,
        404,
      );
    const bytes = await this.download(`${SKILLS_ROOT}/${name}/${file}`);
    const text = asText(bytes);
    if (text === null)
      throw new InputError(
        `${file} is not text. Use workspace_exec on skills/${name}/${file}.`,
      );
    return text;
  }

  /**
   * Saves the editor's text files as the skill's folder. Binary files the
   * folder already held are kept.
   */
  async save(name: string, input: SaveSkill, create: boolean) {
    const nameProblem = skillNameProblem(name);
    if (nameProblem) throw new InputError(nameProblem);
    const existing = (await this.scan()).find((skill) => skill.name === name);
    if (create && existing)
      throw new InputError(`A skill named ${name} already exists.`, 409);
    if (!create && !existing)
      throw new InputError(`There is no skill named ${name}.`, 404);
    const files = new Map<string, Uint8Array>();
    for (const path of existing?.files ?? []) {
      const bytes = await this.download(`${SKILLS_ROOT}/${name}/${path}`);
      if (asText(bytes) === null) files.set(path, bytes);
    }
    for (const file of input.files)
      files.set(file.path, new TextEncoder().encode(file.text));
    await this.write(name, files);
  }

  async remove(name: string) {
    await this.find(name);
    await this.files.replaceTree(`${SKILLS_ROOT}/${name}`, null);
    this.setEnabled(name, true);
    this.forget(name);
    await this.refresh();
  }

  async enable(name: string, enabled: boolean) {
    await this.find(name);
    this.setEnabled(name, enabled);
    await this.refresh();
  }

  /**
   * Installs every skill in `archive` (each folder holding a SKILL.md).
   * Refuses one that exists unless `replace`. Returns the names installed.
   */
  async install(archive: ArchiveFiles, replace: boolean) {
    const found = skillsIn(archive);
    if (!found.size)
      throw new InputError(
        "No skills found. A skill is a folder with a SKILL.md in it.",
      );
    const existing = new Set((await this.scan()).map((skill) => skill.name));
    for (const name of found.keys())
      if (existing.has(name) && !replace)
        throw new InputError(
          `A skill named ${name} already exists. Replace it to import.`,
          409,
        );
    for (const [name, files] of found) await this.write(name, files);
    return [...found.keys()].sort();
  }

  /**
   * Checks and writes one skill folder, then refreshes the instructions.
   * The owner's writes make it theirs again: the bot's changes to it are
   * no longer shown or undone.
   */
  private async write(
    name: string,
    files: Map<string, Uint8Array>,
    byOwner = true,
  ) {
    const skill = files.get("SKILL.md");
    if (!skill) throw new InputError(`${name} has no SKILL.md.`);
    const checked = checkFrontmatter(name, frontmatter(asText(skill) ?? ""));
    if ("problem" in checked) throw new InputError(checked.problem);
    if (files.size > SKILL_LIMITS.files)
      throw new InputError(
        `A skill holds at most ${SKILL_LIMITS.files} files.`,
      );
    let bytes = 0;
    for (const [path, content] of files) {
      const problem = skillPathProblem(path);
      if (problem) throw new InputError(problem);
      bytes += content.length;
    }
    if (bytes > SKILL_LIMITS.bytes)
      throw new InputError("A skill holds at most 2 MiB of files.");
    await this.files.replaceTree(
      `${SKILLS_ROOT}/${name}`,
      [...files].map(([path, content]) => ({
        path: `${SKILLS_ROOT}/${name}/${path}`,
        bytes: content,
      })),
    );
    if (byOwner) this.forget(name);
    await this.refresh();
  }

  /** The bytes of a skill's files, by path inside it. */
  private async contents(name: string, paths: readonly string[]) {
    const files = new Map<string, Uint8Array>();
    for (const path of paths)
      files.set(path, await this.download(`${SKILLS_ROOT}/${name}/${path}`));
    return files;
  }

  private async currentHash(name: string) {
    const skill = (await this.scan()).find((item) => item.name === name);
    return skill
      ? hashText(textFiles(await this.contents(name, skill.files)))
      : null;
  }

  private view(change: StoredChange, current?: string | null): SkillChange {
    const latest = this.changes().findLast((item) => item.name === change.name);
    return {
      id: change.id,
      callId: change.callId,
      name: change.name,
      kind: change.kind,
      at: change.at,
      undoable:
        !change.undone &&
        latest?.id === change.id &&
        (current === undefined || current === change.after),
      undone: !!change.undone,
    };
  }

  private changes(): StoredChange[] {
    try {
      const saved: unknown = JSON.parse(
        this.files.metadata(CHANGES_KEY) ?? "[]",
      );
      return Array.isArray(saved) ? (saved as StoredChange[]) : [];
    } catch {
      return [];
    }
  }

  private saveChanges(changes: StoredChange[]) {
    this.files.setMetadata(
      CHANGES_KEY,
      JSON.stringify(changes.slice(-CHANGE_LIMIT)),
    );
  }

  /** Drops the bot's changes to `name`, once the owner has made it theirs. */
  private forget(name: string) {
    const changes = this.changes();
    if (changes.some((item) => item.name === name))
      this.saveChanges(changes.filter((item) => item.name !== name));
  }

  private async find(name: string) {
    const skill = (await this.scan()).find((item) => item.name === name);
    if (!skill) throw new InputError(`There is no skill named ${name}.`, 404);
    return skill;
  }

  private disabled() {
    try {
      const saved: unknown = JSON.parse(
        this.files.metadata(DISABLED_KEY) ?? "[]",
      );
      return new Set(
        Array.isArray(saved)
          ? saved.filter((n): n is string => typeof n === "string")
          : [],
      );
    } catch {
      return new Set<string>();
    }
  }

  private setEnabled(name: string, enabled: boolean) {
    const disabled = this.disabled();
    if (enabled) disabled.delete(name);
    else disabled.add(name);
    this.files.setMetadata(DISABLED_KEY, JSON.stringify([...disabled].sort()));
  }

  /** Every folder under `skills/`, with what is wrong with it if anything. */
  private async scan(): Promise<Found[]> {
    const root = await this.listing(SKILLS_ROOT);
    if (!root) return [];
    const disabled = this.disabled();
    const changes = this.changes();
    const found: Found[] = [];
    for (const item of root.items) {
      if (item.kind !== "directory") continue;
      const name = item.name;
      const files = await this.walk(`${SKILLS_ROOT}/${name}`);
      files.sort((a, b) =>
        a === "SKILL.md" ? -1 : b === "SKILL.md" ? 1 : a.localeCompare(b),
      );
      let header: SkillHeader | null = null;
      let problem: string | null = null;
      if (!files.includes("SKILL.md")) problem = "This folder has no SKILL.md.";
      else {
        const text = asText(
          await this.download(`${SKILLS_ROOT}/${name}/SKILL.md`),
        );
        const checked = checkFrontmatter(name, frontmatter(text ?? ""));
        if ("problem" in checked) problem = checked.problem;
        else header = checked.header;
      }
      found.push({
        name,
        description: header?.description ?? "",
        enabled: !disabled.has(name),
        files,
        problem,
        botChange: botChange(changes, name),
        header,
      });
    }
    return found.sort((a, b) => a.name.localeCompare(b.name));
  }

  /** The files below `directory`, relative to it, up to the file limit. */
  private async walk(directory: string, prefix = ""): Promise<string[]> {
    const listing = await this.listing(directory);
    const files: string[] = [];
    for (const item of listing?.items ?? []) {
      if (files.length > SKILL_LIMITS.files) break;
      const relative = `${prefix}${item.name}`;
      if (item.kind === "directory")
        files.push(...(await this.walk(item.path, `${relative}/`)));
      else if (item.kind === "file") files.push(relative);
    }
    return files;
  }

  private async listing(path: string) {
    try {
      return await this.files.list(path);
    } catch (error) {
      if (error instanceof InputError && error.status === 404) return null;
      throw error;
    }
  }

  /** A file's bytes, listing its folder for the revision a download needs. */
  private async download(path: string) {
    const parent = path.slice(0, path.lastIndexOf("/"));
    for (let attempt = 0; ; attempt++) {
      const listing = await this.files.list(parent);
      try {
        return (await this.files.download(path, listing.revision)).bytes;
      } catch (error) {
        // The bot changed something between the list and the read.
        if (attempt < 2 && error instanceof InputError && error.status === 409)
          continue;
        throw error;
      }
    }
  }
}

/** The bot's last change to `name`, as Settings shows it. */
function botChange(changes: readonly StoredChange[], name: string) {
  const latest = changes.findLast((item) => item.name === name && !item.undone);
  return latest ? { kind: latest.kind, at: latest.at } : null;
}

/** The text files among a skill's files, sorted by path. */
function textFiles(files: ReadonlyMap<string, Uint8Array>): TextFile[] {
  return [...files]
    .flatMap(([path, bytes]) => {
      const text = asText(bytes);
      return text === null ? [] : [{ path, text }];
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}

function hashText(files: readonly TextFile[]) {
  const hash = createHash("sha256");
  for (const file of files) hash.update(`${file.path}\0${file.text}\0`);
  return hash.digest("hex");
}

/**
 * A `SKILL.md`: frontmatter naming and describing the skill, keeping any
 * other fields it had, then `body`.
 */
export function skillMarkdown(
  name: string,
  description: string,
  body: string,
  previous: Frontmatter | null = null,
) {
  const fields = { ...previous, name, description };
  return `---\n${Bun.YAML.stringify(fields, null, 2).trimEnd()}\n---\n\n${body.trim()}\n`;
}

/** UTF-8 text without NUL bytes, or null for anything else. */
function asText(bytes: Uint8Array): string | null {
  if (bytes.length > TEXT_LIMIT || bytes.includes(0)) return null;
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

/** The YAML between the opening `---` lines of a SKILL.md, or null. */
export function frontmatter(text: string): Frontmatter | null {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---\s*(\r?\n|$)/.exec(text);
  if (!match) return null;
  try {
    const parsed: unknown = Bun.YAML.parse(match[1]!);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Frontmatter)
      : null;
  } catch {
    return null;
  }
}

/**
 * The skills in an archive: each folder holding a `SKILL.md`, by name.
 * A folder's name comes from its SKILL.md when it is the archive's top, so
 * a lone skill zipped without its folder still installs. Hidden files and
 * macOS archive clutter are left out.
 */
export function skillsIn(archive: ArchiveFiles) {
  const skills = new Map<string, Map<string, Uint8Array>>();
  const clutter = (path: string) =>
    path.split("/").some((part) => part.startsWith(".") || part === "__MACOSX");
  const roots = [...archive.keys()]
    .filter((path) => !clutter(path) && /(^|\/)SKILL\.md$/.test(path))
    .map((path) => path.slice(0, -"SKILL.md".length));
  for (const root of roots) {
    // A skill inside another skill's folder belongs to that skill.
    if (roots.some((other) => other !== root && root.startsWith(other)))
      continue;
    const folder = root.replace(/\/$/, "").split("/").at(-1);
    const named = folder
      ? folder
      : frontmatter(asText(archive.get("SKILL.md")!) ?? "")?.name;
    const name = typeof named === "string" ? named : "";
    const files = new Map<string, Uint8Array>();
    for (const [path, bytes] of archive)
      if (path.startsWith(root) && !clutter(path))
        files.set(path.slice(root.length), bytes);
    if (skills.has(name))
      throw new InputError(`The archive holds two skills named ${name}.`);
    skills.set(name, files);
  }
  return skills;
}
