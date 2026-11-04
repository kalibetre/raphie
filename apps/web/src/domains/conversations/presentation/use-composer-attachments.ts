import type { Attachment } from "@raphie/contracts";
import { useEffect, useRef, useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import {
  readLocal,
  writeLocal,
} from "../../../infrastructure/preferences/storage";

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

/** Upload completions always belong to the draft that initiated them. */
export function useComposerAttachments(
  key: string,
  onError: (error: string) => void,
) {
  const { workspace } = useBackend();
  const [files, setFiles] = useState<Attachment[]>([]);
  const [uploading, setUploading] = useState(false);
  const activeKey = useRef(key);
  useEffect(() => {
    activeKey.current = key;
  }, [key]);
  useEffect(() => {
    setFiles(readDraftAttachments(key));
  }, [key]);

  function save(next: Attachment[], targetKey = key) {
    writeLocal(`${targetKey}:attachments`, JSON.stringify(next));
    if (activeKey.current === targetKey) setFiles(next);
  }

  async function upload(selected: FileList) {
    const targetKey = key;
    const chosen = Array.from(selected);
    if (files.length + chosen.length > 4) {
      onError("Attach at most four files.");
      return;
    }
    if (chosen.some((file) => file.size > 8 * 1024 * 1024)) {
      onError("Files must be 8 MiB or smaller.");
      return;
    }
    setUploading(true);
    let next = files;
    try {
      for (const file of chosen) {
        const form = new FormData();
        form.append("file", file);
        const saved = await workspace.api<Attachment>("/api/attachments", form);
        next = [...next.filter((f) => f.id !== saved.id), saved];
        save(next, targetKey);
      }
    } catch (error) {
      if (activeKey.current === targetKey)
        onError(
          error instanceof Error
            ? error.message
            : "Upload failed. Please retry.",
        );
    } finally {
      setUploading(false);
    }
  }

  return { files, uploading, upload, save };
}
