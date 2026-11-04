# General attachments

The conversation composer accepts up to four files per message, at most 8 MiB
per file. Use **Attach files**, choose files, then send text, files, or both.
Uploading saves a working file under `/workspace/uploads/<content-id>/<name>`.
It is immediately visible in Workspace and usable by the bot's workspace tools,
including after switching execution environments. Names are sanitized; long
Unicode names may be shortened in the working path while retaining their display
name. Each bot has a separate namespace and archive.

Files and text can be queued during a running task. Steer, Keep queued and Stop
retain their existing behavior. Attached-file chips have keyboard-accessible
removal controls. Removing a chip detaches it from the draft; it does not delete
the uploaded workspace file. Failed uploads and failed sends leave the text draft
and successfully uploaded references available for retry. Draft references are
saved separately from existing text drafts and scoped to backend, bot and session.
Changing backends retires outstanding responses. A completion for another draft
cannot clear or attach files to the currently selected draft. Uploads are sequential;
a partial batch keeps the files that already uploaded successfully.

Conversation history records the original ID, display name, size, MIME category
and workspace path. File links download the original bytes as an octet-stream
attachment. Originals are immutable content-addressed archive versions outside the
execution environment; tools can edit or delete working copies without changing
old messages or pending approval deliveries. Repeating the same original name and
bytes uses the same ID/path. A different version gets a different ID. An upload
retry refuses a working path that has been replaced with different content or a
symlink rather than overwriting the bot's edits. Restore/remove that path before
uploading the original again. Working files are mutable; a path in old history can
subsequently be missing or changed.

PNG, JPEG, GIF and WebP signatures are recognized from bytes. When the selected
model advertises image input support, these original bytes are included as image
content in the durable input. Text-only models receive file references. Images are
not resized, converted or OCRed locally, and providers can reject individual
formats, corrupt files or image-size limits. Accepted image bytes persist with the
admitted task, so recovery does not substitute an edited working copy.

The `read_document` tool reads workspace files in either execution provider. It
uses local AnyDoc conversion for PDFs, Word, Excel, PowerPoint, CSV, OpenDocument,
RTF and EPUB and returns Markdown in 16,000-character chunks with a continuation
offset. Inputs are limited to 8 MiB. Conversion runs in a time-limited worker,
without inherited credentials or hosted requests. Plain text files remain readable
using the workspace's existing tools.

AnyDoc rejects an entire PDF if any page appears to need OCR. Raphie falls back to
local PDF text extraction, marks the result as potentially incomplete and identifies
empty pages. The fallback processes at most 200 pages or roughly one million
characters and reports if it stopped early. It does not perform OCR or render
scans, so image-only content is unavailable. Encrypted, unsupported and malformed
files return an error; extracted text can lose complex layout or embedded images.

## Persistence and limits

The complete just-bash workspace, including all upload working copies, must fit
its existing 8 MiB content, 1,024-entry and 12 MiB checkpoint bounds. Four 8 MiB
files are therefore possible only with a sufficiently provisioned Container
workspace. Imports fail atomically if lightweight capacity is exceeded, leaving
existing workspace state and messages unchanged. A file that exactly fills the
8 MiB content budget remains executable; interpreter command stubs use a separate
small fixed allowance. Native upload writes use temporary files and exclusive
publication inside the guest, so interruption cannot publish a partial final
file. Native background mutation remains subject to the existing container
semantics; upload parent checks are not an OS security boundary.

The archive retains original bytes even if a subsequent workspace import fails.
No automatic deletion, retention limit or archive garbage collection is added.
Unused uploads and failed-attempt originals can consume host storage. Native disk
quota remains an admission check, not a hard filesystem quota. Back up the archive,
workspace state and gateway history together; see [workspaces](bot-workspaces.md).

The existing file-copy approval experiment and Discord `/copy` retain their
archival behavior, IDs, links and pending approvals. Their archive is not silently
bulk-imported into the bounded workspace. General Discord chat uploads remain
unsupported; this delivery adds the web conversation composer. External service
tools still use the existing owner approval gate. Local uploads do not authorize
external delivery and contain no provider credentials.

## HTTP contract

- `POST /api/attachments`: multipart `file`, returns the uploaded `Attachment`.
  The client sends its usual `x-raphie-client: web` header; fetch supplies the
  multipart boundary. Oversize bodies/files are rejected before admission.
- `POST /api/sessions/messages`: adds optional `attachments: string[]` (up to four
  unique uploaded IDs). `text` may be empty when at least one ID is present.
  IDs resolve only within the addressed bot. Attachment IDs participate in the
  stable event fingerprint; conflicting retries return 409. Text-only
  fingerprints remain compatible with existing events.
- `GET /api/files/:id`: downloads a published general upload or an existing
  approval attachment. Unpublished/orphaned archive bytes cannot be downloaded
  through a guessed ID. The existing owner Host/Origin checks cover these routes.

Named bots use the existing `/api/bots/<id>` prefix. Session history and observation
responses include optional `attachments` metadata; old turns remain unchanged.
No schema reset, approval migration or credential-store change is required.

Verification covers real Pi tools, immutable originals, message retries, bot
isolation, image-capability filtering and restart, PDF references, full-workspace
failure, queued/steered/stopped messages, multipart request scoping, draft storage
and accessible rendering. Native tests exercise byte-exact uploads, duplicate
retries, symlink refusal, provider switching and stale environment views. The
workspace transition tests additionally cover legacy conflicts, bounds and an
interrupted disk publication. Run `bun run validate`; native isolation evidence
requires a run with Docker and the fixture image available, not skipped tests.

Delivery validation on 2026-11-04: `bun run validate` passed 315 tests with no
failures or skips, including real Docker, formatting, architecture, lint, type
checks and the production build. See the [quality review](reviews/2026-11-04-general-attachments.md)
for findings, corrections and validation limits.
