import type { Attachment } from "@raphie/contracts";
import { Paperclip } from "lucide-react";
import { useRef } from "react";

import type { BackendWorkspace } from "../../../infrastructure/http/backend-workspace";
import { Button } from "../../../shared/ui/button";
import { ScrollArea } from "../../../shared/ui/scroll-area";
import { AttachmentCard } from "./attachment-card";

export function ComposerAttachments({
  files,
  disabled,
  onUpload,
}: {
  files: Attachment[];
  disabled: boolean;
  onUpload: (files: FileList) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <>
      <input
        ref={input}
        type="file"
        tabIndex={-1}
        multiple
        className="sr-only"
        aria-label="Choose attachments"
        disabled={disabled}
        onChange={(event) => {
          if (event.target.files?.length) onUpload(event.target.files);
          event.target.value = "";
        }}
      />
      <Button
        type="button"
        variant="ghost"
        size="icon"
        aria-label="Attach files"
        title="Attach files (up to four, 8 MiB each)"
        disabled={disabled || files.length >= 4}
        onClick={() => input.current?.click()}
      >
        <Paperclip aria-hidden="true" />
      </Button>
    </>
  );
}

export function AttachmentChips({
  files,
  disabled,
  onRemove,
  workspace,
}: {
  files: Attachment[];
  disabled: boolean;
  onRemove: (id: string) => void;
  workspace: BackendWorkspace;
}) {
  return (
    <>
      {files.length > 0 && (
        <ScrollArea
          className="composer-attachment-scroll"
          orientation="horizontal"
          viewportLabel="Attached files"
        >
          <ul className="composer-attachments" aria-label="Attached files">
            {files.map((file) => (
              <li key={file.id}>
                <AttachmentCard
                  file={file}
                  workspace={workspace}
                  disabled={disabled}
                  onRemove={() => onRemove(file.id)}
                />
              </li>
            ))}
          </ul>
        </ScrollArea>
      )}
    </>
  );
}
