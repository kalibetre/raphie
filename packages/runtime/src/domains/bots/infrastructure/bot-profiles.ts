import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type {
  BotProfile,
  OwnerProfile,
  SaveBotProfile,
  SaveOwnerProfile,
  SelfUpdates,
  UpdateBotProfile,
} from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import {
  DEFAULT_REPLY_STYLE,
  replyStyleOf,
} from "../../conversations/domain/reply-style.ts";
import {
  cleanInstructions,
  DEFAULT_INSTRUCTIONS,
  withRules,
} from "../domain/instructions.ts";
import { EMPTY_OWNER } from "../domain/owner.ts";
import { PERSONALITY_PRESETS, presetOf } from "../domain/personalities.ts";

/**
 * What a bot may change by itself until the owner says otherwise: every bot
 * its own personality and skills, and only the default bot the owner's
 * profile.
 */
export function defaultSelfUpdates(id: string): SelfUpdates {
  return { personality: true, owner: id === "default", skills: true };
}

/**
 * A stored profile, with a reply style, self-updates and instructions even
 * if it was saved before any of them. Standing rules saved before they
 * became instructions read as a list at the top of them.
 */
function parse(value: string): BotProfile {
  const { rules, ...profile } = JSON.parse(value) as BotProfile & {
    rules?: string[];
  };
  return {
    ...profile,
    replyStyle: replyStyleOf(profile.replyStyle),
    selfUpdates: {
      ...defaultSelfUpdates(profile.id),
      ...profile.selfUpdates,
    },
    instructions: withRules(profile.instructions ?? "", rules ?? []),
  };
}

/**
 * The owner profile as kept: instructions null while they are Raphie's,
 * so they follow each release until someone changes them.
 */
type StoredOwner = Omit<
  OwnerProfile,
  "instructions" | "instructionsDefault"
> & {
  instructions?: string | null;
  /** Standing rules for every bot, kept before they became instructions. */
  rules?: string[];
};

export const defaultBot = {
  id: "default",
  name: "Raphie",
  description: "Your personal assistant.",
  personality: PERSONALITY_PRESETS[0]!.personality,
};

/** Trusted configuration, separate from the bot's files and agent-editable memory. */
export class BotProfileStore {
  private readonly db: Database;

  constructor(path: string) {
    mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    this.db = new Database(path, { create: true, strict: true });
    chmodSync(path, 0o600);
    this.db.exec(
      "PRAGMA journal_mode=WAL; PRAGMA synchronous=FULL; CREATE TABLE IF NOT EXISTS bot_profiles (id TEXT PRIMARY KEY, value TEXT NOT NULL); CREATE TABLE IF NOT EXISTS bot_revisions (id TEXT NOT NULL, revision INTEGER NOT NULL, value TEXT NOT NULL, PRIMARY KEY(id,revision))",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS bot_deletions (id TEXT PRIMARY KEY)",
    );
    this.db.exec(
      "CREATE TABLE IF NOT EXISTS owner_profile (id INTEGER PRIMARY KEY CHECK (id = 1), value TEXT NOT NULL)",
    );
    // Profiles saved before the personality had its own name kept it as
    // `soul`; rename it in place, current profile and revisions alike.
    for (const table of ["bot_profiles", "bot_revisions"])
      this.db.exec(
        `UPDATE ${table} SET value=json_remove(json_set(value,'$.personality',json_extract(value,'$.soul')),'$.soul') WHERE json_type(value,'$.soul') IS NOT NULL`,
      );
    this.moveRulesIntoInstructions();
    if (
      !this.db.query("SELECT id FROM bot_profiles WHERE id='default'").get()
    ) {
      const at = Date.now();
      this.insert({
        ...defaultBot,
        replyStyle: DEFAULT_REPLY_STYLE,
        selfUpdates: defaultSelfUpdates("default"),
        instructions: "",
        changedBy: "owner",
        preset: presetOf(defaultBot.personality),
        revision: 1,
        createdAt: at,
        updatedAt: at,
      });
    }
  }

  list(): BotProfile[] {
    return this.db
      .query<{ value: string }, []>(
        "SELECT value FROM bot_profiles WHERE id NOT IN (SELECT id FROM bot_deletions) ORDER BY CASE WHEN id='default' THEN 0 ELSE 1 END, rowid",
      )
      .all()
      .map((row) => parse(row.value));
  }

  read(id: string): BotProfile {
    const row = this.db
      .query<{ value: string }, [string]>(
        "SELECT value FROM bot_profiles WHERE id=? AND id NOT IN (SELECT id FROM bot_deletions)",
      )
      .get(id);
    if (!row) throw new InputError("Bot not found.", 404);
    return parse(row.value);
  }

  history(id: string): BotProfile[] {
    this.read(id);
    return this.db
      .query<{ value: string }, [string]>(
        "SELECT value FROM bot_revisions WHERE id=? ORDER BY revision DESC LIMIT 50",
      )
      .all(id)
      .map((row) => parse(row.value));
  }

  draft(input: SaveBotProfile): BotProfile {
    const at = Date.now();
    const id = crypto.randomUUID();
    return {
      ...input,
      replyStyle: replyStyleOf(input.replyStyle),
      selfUpdates: { ...defaultSelfUpdates(id), ...input.selfUpdates },
      instructions: cleanInstructions(input.instructions ?? ""),
      changedBy: "owner",
      preset: presetOf(input.personality),
      id,
      revision: 1,
      createdAt: at,
      updatedAt: at,
    };
  }

  insert(profile: BotProfile) {
    const value = JSON.stringify(profile);
    this.db.transaction(() => {
      this.db
        .query("INSERT INTO bot_profiles(id,value) VALUES(?,?)")
        .run(profile.id, value);
      this.db
        .query("INSERT INTO bot_revisions(id,revision,value) VALUES(?,?,?)")
        .run(profile.id, profile.revision, value);
    })();
    return profile;
  }

  update(id: string, input: UpdateBotProfile) {
    return this.db.transaction(() => {
      const previous = this.read(id);
      if (input.revision !== previous.revision)
        throw new InputError(
          "This bot was changed elsewhere. Reload before saving.",
          409,
        );
      return this.write({
        ...previous,
        ...input,
        replyStyle: input.replyStyle ?? previous.replyStyle,
        selfUpdates: { ...previous.selfUpdates, ...input.selfUpdates },
        instructions:
          input.instructions === undefined
            ? previous.instructions
            : cleanInstructions(input.instructions),
        changedBy: "owner",
      });
    })();
  }

  /**
   * The bot changes its own personality: a new revision, saved by it.
   * Unchanged text saves nothing, so a repeated call adds no revision.
   */
  updatePersonality(id: string, personality: string) {
    return this.db.transaction(() => {
      const previous = this.read(id);
      return previous.personality === personality
        ? previous
        : this.write({ ...previous, personality, changedBy: "bot" });
    })();
  }

  /**
   * The bot changes its own instructions: a new revision, saved by it.
   * Unchanged text saves nothing.
   */
  updateInstructions(id: string, instructions: string) {
    return this.db.transaction(() => {
      const previous = this.read(id);
      const next = cleanInstructions(instructions);
      return previous.instructions === next
        ? previous
        : this.write({ ...previous, instructions: next, changedBy: "bot" });
    })();
  }

  /** Saves `profile` as the next revision. */
  private write(profile: BotProfile) {
    const next = {
      ...profile,
      preset: presetOf(profile.personality),
      revision: profile.revision + 1,
      updatedAt: Date.now(),
    };
    const value = JSON.stringify(next);
    this.db
      .query("UPDATE bot_profiles SET value=? WHERE id=?")
      .run(value, next.id);
    this.db
      .query("INSERT INTO bot_revisions(id,revision,value) VALUES(?,?,?)")
      .run(next.id, next.revision, value);
    return next;
  }

  /** The owner as every bot knows them; empty until they say something. */
  owner(): OwnerProfile {
    const { instructions, rules: _, ...owner } = this.storedOwner();
    return {
      ...owner,
      instructions: instructions ?? DEFAULT_INSTRUCTIONS,
      instructionsDefault: instructions === null || instructions === undefined,
    };
  }

  saveOwner(input: SaveOwnerProfile): OwnerProfile {
    const previous = this.storedOwner();
    const instructions =
      input.instructions === undefined
        ? previous.instructions
        : input.instructions === null
          ? null
          : cleanInstructions(input.instructions);
    // Fields are picked, so a whole profile sent back stores only these.
    const owner: StoredOwner = {
      name: input.name,
      callMe: input.callMe,
      timeZone: input.timeZone,
      about: input.about,
      // Saved unchanged, Raphie's text stays Raphie's and keeps following releases.
      instructions: instructions === DEFAULT_INSTRUCTIONS ? null : instructions,
      updatedAt: Date.now(),
    };
    this.db
      .query(
        "INSERT INTO owner_profile(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(owner));
    return this.owner();
  }

  private storedOwner(): StoredOwner {
    const row = this.db
      .query<{ value: string }, []>("SELECT value FROM owner_profile")
      .get();
    const { instructions: _, instructionsDefault: __, ...empty } = EMPTY_OWNER;
    return row
      ? { ...empty, ...(JSON.parse(row.value) as StoredOwner) }
      : { ...empty, instructions: null };
  }

  /**
   * Standing rules became instructions: each list of rules moves to the
   * top of the instructions it belongs with, once. The owner's rules make
   * the instructions for every bot their own, no longer Raphie's.
   * Revisions keep their rules and read them the same way.
   */
  private moveRulesIntoInstructions() {
    this.db.transaction(() => {
      for (const row of this.db
        .query<{ id: string; value: string }, []>(
          "SELECT id,value FROM bot_profiles WHERE json_array_length(value,'$.rules') > 0",
        )
        .all())
        this.db
          .query("UPDATE bot_profiles SET value=? WHERE id=?")
          .run(JSON.stringify(parse(row.value)), row.id);
      const owner = this.db
        .query<{ value: string }, []>(
          "SELECT value FROM owner_profile WHERE json_array_length(value,'$.rules') > 0",
        )
        .get();
      if (owner) {
        const { rules, ...stored } = JSON.parse(owner.value) as StoredOwner;
        this.db.query("UPDATE owner_profile SET value=? WHERE id=1").run(
          JSON.stringify({
            ...stored,
            instructions: withRules(
              stored.instructions ?? DEFAULT_INSTRUCTIONS,
              rules ?? [],
            ),
          }),
        );
      }
    })();
  }

  close() {
    this.db.close();
  }

  deletions(): string[] {
    return this.db
      .query<{ id: string }, []>("SELECT id FROM bot_deletions")
      .all()
      .map((row) => row.id);
  }

  markDeleting(id: string) {
    this.db.query("INSERT INTO bot_deletions(id) VALUES(?)").run(id);
  }

  finishDeletion(id: string) {
    this.db.transaction(() => {
      this.db.query("DELETE FROM bot_revisions WHERE id=?").run(id);
      this.db.query("DELETE FROM bot_profiles WHERE id=?").run(id);
      this.db.query("DELETE FROM bot_deletions WHERE id=?").run(id);
    })();
  }
}
