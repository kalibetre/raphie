import type { Attachment } from "@raphie/contracts";
import { useEffect, useSyncExternalStore } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { attachmentDrafts } from "../infrastructure/attachment-drafts";

export { readDraftAttachments } from "../infrastructure/attachment-drafts";

export function useComposerAttachments(
  key: string,
  onError: (error: string) => void,
) {
  const { workspace } = useBackend();
  const store = attachmentDrafts(workspace);
  const draft = useSyncExternalStore(
    (listener) => store.subscribe(key, listener),
    () => store.snapshot(key),
    () => store.snapshot(key),
  );
  useEffect(() => {
    if (draft.error) onError(draft.error);
  }, [draft.error, onError]);
  return {
    files: draft.files,
    uploading: draft.uploading,
    upload: (selected: FileList) => store.upload(key, Array.from(selected)),
    save: (files: Attachment[], targetKey = key) =>
      store.save(targetKey, files),
    removeSent: (files: Attachment[], targetKey = key) =>
      store.removeSent(targetKey, files),
  };
}
