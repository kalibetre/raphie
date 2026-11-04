# Unified workspace and general attachments review

Implementation review performed by the implementation agent using the
`code-review-and-quality` five-axis process. This is a self-review, not a separate
reviewer or model's approval. No merge, deployment or provider activation in a
user store was performed.

## Correctness

Reviewed file-state ownership, both transfer directions, legacy adoption,
transaction/rename crash windows, stable execution receipts, pending approvals,
message fingerprints, history projections and task controls. Required findings
were corrected and covered by regression tests:

- Preserve committed reads during a running just-bash command; serializing them
  behind compute invalidated an otherwise valid download revision.
- Include attachment metadata in the focused history/observation query, not only
  the persisted turn and compatibility snapshot.
- Preserve the complete legacy lightweight tree alongside native conflicts and
  journal adoption before publication. Oversized adoption must preserve recovery
  settings and remain retryable across restarts.
- Keep exact-capacity 8 MiB checkpoints executable by reserving fixed space for
  interpreter command stubs; retain the 8 MiB workspace-content bound.
- Publish native uploads atomically so interruption never leaves a partial final
  file; refuse links and different content at the published path.
- Clean quiesced backup/staging trees containing mode-000 directories without
  following links, so repeated restart/publication cannot strand recovery.

## Readability and architecture

RuntimeWorkspace owns provider selection and transfers. BotWorkspace owns the
atomic checkpoint/settings/receipt journal. The disk adapter owns bounded
snapshots, migration and recoverable publication. Native upload publication stays
inside the guest and runs through the existing serialized operation queue.

Composer upload state and controls are separate from message submission and task
actions. Existing text-draft keys remain unchanged; references use a companion
key. Immutable originals reuse the archival store and preserve its old `put`
behavior, avoiding a new capacity dependency in approval recovery. This immutable
version policy is an implementation choice, not a user-selected requirement.
The subsequent document reader adds AnyDoc and PDF.js dependencies and updates the lockfile.

## Security

Checked per-bot capability closure, ID resolution and download authorization,
Host/Origin/CSRF protections, untrusted names, byte bounds, header encoding,
symlink handling and guest-only native writes. Host snapshots run only after the
native epoch fence. Archive originals, settings, credentials and control databases
are outside the mounted workspace. No credential resolution, provider permission,
MCP approval or uncertain external-effect replay policy changed. Native networking
retains its existing acknowledged limitations.

## Performance

Uploads are bounded per file and queued per workspace. Native-to-lightweight
snapshotting checks entry counts and byte sizes before reading content. Just-bash
commands and uploads commit the checkpoint without rewriting a disk tree on every
operation; materialization occurs on startup and provider transition. Image bytes
are read only for image-category uploads when the selected model supports images.
The existing bounded synchronous container lifecycle remains unchanged.

## Validation and remaining limits

Focused regressions cover real Pi tools, original downloads after edits, cross-bot
rejection, image capability filtering and recovery, PDF file-only inputs,
full-workspace rejection, queued/steered/stopped attachment messages, multipart
request scoping, retired backends, draft storage and accessible control rendering.
Real-container regressions cover native uploads, exact binary bytes, duplicate
uploads, symlink refusal, stale views and switches in both directions. Existing
approval, crash, isolation and Pi conformance suites are included in the full gate.

No critical or required finding remains in this review. Automated validation does
not replace an independent review. Browser interaction/responsive acceptance and
real-provider image acceptance were not run. Rendering/request/storage tests and
the production build cover the frontend changes; provider tests use deterministic
models. PDFs require suitable tools, larger workspaces cannot switch to just-bash,
and immutable originals/unused uploads have no automatic garbage collection.
Legacy approval archives are preserved in place rather than bulk-imported into a
bounded workspace. These limitations are documented in
[general attachments](../general-attachments.md) and
[bot workspaces](../bot-workspaces.md).

Final gate on 2026-11-04: `bun run validate` passed **315 tests, zero failures and
zero skips**, including real Docker and Pi conformance. Formatting, architecture,
type-aware lint, all package type checks and the production build passed. Vite
retains its chunk-size advisory. The initial sandboxed attempt could not bind
fixture HTTP ports; the complete successful gate ran with fixture networking and
Docker access. No live bot data or external model calls were used.
