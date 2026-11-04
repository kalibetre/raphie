import type { Attachment } from "@raphie/contracts";

import type { BackendWorkspace } from "../../../infrastructure/http/backend-workspace";
import {
  readLocal,
  writeLocal,
} from "../../../infrastructure/preferences/storage";

export type AttachmentDraft = {
  files: Attachment[];
  uploading: boolean;
  error?: string;
};

type Listener = () => void;

export function readDraftAttachments(key: string): Attachment[] {
  try {
    const saved: unknown = JSON.parse(readLocal(`${key}:attachments`) ?? "[]");
    return Array.isArray(saved)
      ? saved
          .filter(
            (file): file is Attachment =>
              file &&
              typeof file === "object" &&
              typeof file.id === "string" &&
              /^[a-f0-9]{64}$/.test(file.id) &&
              typeof file.name === "string" &&
              typeof file.size === "number",
          )
          .slice(0, 4)
      : [];
  } catch {
    return [];
  }
}

/** One store per bot/backend keeps uploads alive across composer mounts. */
export class AttachmentDrafts {
  private readonly drafts = new Map<string, AttachmentDraft>();
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(private readonly workspace: Pick<BackendWorkspace, "api">) {}

  snapshot(key: string): AttachmentDraft {
    let draft = this.drafts.get(key);
    if (!draft) {
      draft = { files: readDraftAttachments(key), uploading: false };
      this.drafts.set(key, draft);
    }
    return draft;
  }

  subscribe(key: string, listener: Listener) {
    let listeners = this.listeners.get(key);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(key, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(key);
    };
  }

  private update(key: string, changes: Partial<AttachmentDraft>) {
    const draft = { ...this.snapshot(key), ...changes };
    this.drafts.set(key, draft);
    if (changes.files)
      writeLocal(`${key}:attachments`, JSON.stringify(changes.files));
    for (const listener of this.listeners.get(key) ?? []) listener();
  }

  save(key: string, files: Attachment[]) {
    this.update(key, { files });
  }

  removeSent(key: string, files: Attachment[]) {
    const ids = new Set(files.map((file) => file.id));
    this.save(
      key,
      this.snapshot(key).files.filter((file) => !ids.has(file.id)),
    );
  }

  async upload(key: string, chosen: File[]) {
    const current = this.snapshot(key);
    if (current.uploading) return;
    if (current.files.length + chosen.length > 4) {
      this.update(key, { error: "Attach at most four files." });
      return;
    }
    if (chosen.some((file) => file.size > 8 * 1024 * 1024)) {
      this.update(key, { error: "Files must be 8 MiB or smaller." });
      return;
    }
    this.update(key, { uploading: true, error: undefined });
    try {
      for (const file of chosen) {
        const form = new FormData();
        form.append("file", file);
        const saved = await this.workspace.api<Attachment>(
          "/api/attachments",
          form,
        );
        this.save(key, [
          ...this.snapshot(key).files.filter((item) => item.id !== saved.id),
          saved,
        ]);
      }
    } catch (error) {
      this.update(key, {
        error:
          error instanceof Error
            ? error.message
            : "Upload failed. Please retry.",
      });
    } finally {
      this.update(key, { uploading: false });
    }
  }
}

const stores = new WeakMap<BackendWorkspace, AttachmentDrafts>();

export function attachmentDrafts(workspace: BackendWorkspace) {
  let store = stores.get(workspace);
  if (!store) {
    store = new AttachmentDrafts(workspace);
    stores.set(workspace, store);
  }
  return store;
}
