import type { Attachment } from "@raphie/contracts";
import { Download, FileText, Image as ImageIcon, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import type { BackendWorkspace } from "../../../infrastructure/http/backend-workspace";

type Preview = { workspace: BackendWorkspace; id: string; url: string };

const imageTypes = new Set([
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",
]);

function fileSize(size: number) {
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

export function AttachmentCard({
  file,
  workspace,
  onRemove,
  disabled,
  onError,
}: {
  file: Attachment;
  workspace: BackendWorkspace;
  onRemove?: () => void;
  disabled?: boolean;
  onError?: () => void;
}) {
  const [preview, setPreview] = useState<Preview>();
  const [downloading, setDownloading] = useState(false);
  const [visible, setVisible] = useState(false);
  const previewElement = useRef<HTMLDivElement>(null);
  const isImage = !!file.mimeType && imageTypes.has(file.mimeType);
  const mimeType = file.mimeType;
  useEffect(() => {
    const element = previewElement.current;
    if (!isImage || !element) return;
    if (typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries.some((entry) => entry.isIntersecting)) {
          setVisible(true);
          observer.disconnect();
        }
      },
      { rootMargin: "100px" },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [isImage]);
  useEffect(() => {
    if (!visible || !isImage || !mimeType) return;
    let active = true;
    let url: string | undefined;
    void workspace
      .download(`/api/files/${file.id}`)
      .then((blob) => {
        if (!active) return;
        url = URL.createObjectURL(new Blob([blob], { type: mimeType }));
        setPreview({ workspace, id: file.id, url });
      })
      .catch(() => {});
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [workspace, file.id, isImage, mimeType, visible]);

  async function download() {
    setDownloading(true);
    try {
      const blob = await workspace.download(`/api/files/${file.id}`);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = file.name;
      link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch {
      onError?.();
    } finally {
      setDownloading(false);
    }
  }

  const imageUrl =
    preview?.workspace === workspace && preview.id === file.id
      ? preview.url
      : undefined;
  return (
    <div className="attachment-card" data-image={isImage || undefined}>
      <div
        className="attachment-card-preview"
        ref={previewElement}
        aria-hidden="true"
      >
        {imageUrl ? (
          <img src={imageUrl} alt="" onError={() => setPreview(undefined)} />
        ) : isImage ? (
          <ImageIcon size={20} />
        ) : (
          <FileText size={20} />
        )}
      </div>
      <div className="attachment-card-info">
        <span className="attachment-card-name" title={file.name}>
          {file.name}
        </span>
        <span className="attachment-card-size">{fileSize(file.size)}</span>
      </div>
      {onRemove ? (
        <button
          type="button"
          className="attachment-card-action"
          aria-label={`Remove ${file.name}`}
          title="Remove attachment"
          disabled={disabled}
          onClick={onRemove}
        >
          <X size={15} aria-hidden="true" />
        </button>
      ) : (
        <button
          type="button"
          className="attachment-card-action"
          aria-label={`Download ${file.name}`}
          title="Download attachment"
          disabled={downloading}
          onClick={() => void download()}
        >
          <Download size={16} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
