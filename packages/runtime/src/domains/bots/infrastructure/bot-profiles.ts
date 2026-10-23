import { Database } from "bun:sqlite";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import type {
  BotProfile,
  SaveBotProfile,
  UpdateBotProfile,
} from "@raphie/contracts";

import { InputError } from "../../../shared/application/input-error.ts";

export const defaultBot = {
  id: "default",
  name: "Raphie",
  description: "Your personal assistant.",
  soul: "Be concise, thoughtful and candid. Use a warm, natural voice. Ask when important context is missing. Distinguish evidence from inference, and never claim an action succeeded without confirmation.",
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
    if (
      !this.db.query("SELECT id FROM bot_profiles WHERE id='default'").get()
    ) {
      const at = Date.now();
      this.insert({ ...defaultBot, revision: 1, createdAt: at, updatedAt: at });
    }
  }

  list(): BotProfile[] {
    return this.db
      .query<{ value: string }, []>(
        "SELECT value FROM bot_profiles ORDER BY CASE WHEN id='default' THEN 0 ELSE 1 END, rowid",
      )
      .all()
      .map((row) => JSON.parse(row.value) as BotProfile);
  }

  read(id: string): BotProfile {
    const row = this.db
      .query<{ value: string }, [string]>(
        "SELECT value FROM bot_profiles WHERE id=?",
      )
      .get(id);
    if (!row) throw new InputError("Bot not found.", 404);
    return JSON.parse(row.value) as BotProfile;
  }

  history(id: string): BotProfile[] {
    this.read(id);
    return this.db
      .query<{ value: string }, [string]>(
        "SELECT value FROM bot_revisions WHERE id=? ORDER BY revision DESC LIMIT 50",
      )
      .all(id)
      .map((row) => JSON.parse(row.value) as BotProfile);
  }

  draft(input: SaveBotProfile): BotProfile {
    const at = Date.now();
    return {
      ...input,
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

  close() {
    this.db.close();
  }
}
