import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type {
  BotProfile,
  OwnerProfile,
  SaveBotProfile,
  SaveOwnerProfile,
  UpdateBotProfile,
} from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";
import {
  DEFAULT_REPLY_STYLE,
  replyStyleOf,
} from "../../conversations/domain/reply-style.ts";
import { EMPTY_OWNER } from "../domain/owner.ts";

/** A stored profile, with a reply style even if it was saved before one. */
function parse(value: string): BotProfile {
  const profile = JSON.parse(value) as BotProfile;
  return { ...profile, replyStyle: replyStyleOf(profile.replyStyle) };
}

export const defaultBot = {
  id: "default",
  name: "Raphie",
  description: "Your personal assistant.",
  personality:
    "Be concise, thoughtful and candid. Use a warm, natural voice. Ask when important context is missing. Distinguish evidence from inference, and never claim an action succeeded without confirmation.",
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
    if (
      !this.db.query("SELECT id FROM bot_profiles WHERE id='default'").get()
    ) {
      const at = Date.now();
      this.insert({
        ...defaultBot,
        replyStyle: DEFAULT_REPLY_STYLE,
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
    return {
      ...input,
      replyStyle: replyStyleOf(input.replyStyle),
      id: crypto.randomUUID(),
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
      const next = {
        ...previous,
        ...input,
        replyStyle: input.replyStyle ?? previous.replyStyle,
        revision: previous.revision + 1,
        updatedAt: Date.now(),
      };
      const value = JSON.stringify(next);
      this.db
        .query("UPDATE bot_profiles SET value=? WHERE id=?")
        .run(value, id);
      this.db
        .query("INSERT INTO bot_revisions(id,revision,value) VALUES(?,?,?)")
        .run(id, next.revision, value);
      return next;
    })();
  }

  /** The owner as every bot knows them; empty until they say something. */
  owner(): OwnerProfile {
    const row = this.db
      .query<{ value: string }, []>("SELECT value FROM owner_profile")
      .get();
    return row
      ? { ...EMPTY_OWNER, ...(JSON.parse(row.value) as OwnerProfile) }
      : EMPTY_OWNER;
  }

  saveOwner(input: SaveOwnerProfile): OwnerProfile {
    const owner = { ...input, updatedAt: Date.now() };
    this.db
      .query(
        "INSERT INTO owner_profile(id,value) VALUES(1,?) ON CONFLICT(id) DO UPDATE SET value=excluded.value",
      )
      .run(JSON.stringify(owner));
    return owner;
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
