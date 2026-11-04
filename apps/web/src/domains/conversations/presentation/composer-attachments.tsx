import type { Attachment } from "@raphie/contracts";
import { Paperclip, X } from "lucide-react";
import { useRef } from "react";

import { Button } from "../../../shared/ui/button";

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
}: {
  files: Attachment[];
  disabled: boolean;
  onRemove: (id: string) => void;
}) {
  return (
    <>
      {files.length > 0 && (
        <ul className="composer-attachments" aria-label="Attached files">
          {files.map((file) => (
            <li key={file.id}>
              <span title={file.name}>{file.name}</span>
              <button
                type="button"
                aria-label={`Remove ${file.name}`}
                disabled={disabled}
                onClick={() => onRemove(file.id)}
              >
                <X size={14} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </>
  );
}
