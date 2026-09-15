# Effect on Bun for the core module

ADR 0001 calls for a framework-independent core module exposing domain operations, with tests that hit a real filesystem/git rather than mocks. We're implementing that module with [Effect](https://effect.website) rather than plain async functions: domain errors (e.g. an EnvVar import failure, a Link conflict) become typed `Data.TaggedError` values instead of thrown exceptions the caller has to guess at, and filesystem access goes through Effect's `FileSystem`/`Path` services rather than raw `node:fs` calls scattered through the module.

GPUIX (ADR 0002) runs on Bun, so the core module is layered against `@effect/platform-bun`'s live `FileSystem`/`Path` implementation — a real implementation, not a mock, so it satisfies ADR 0001's testing rule as-is: tests provide the same live layer pointed at a temp directory instead of the real `~/.config/raphie`.

**Folder selection**: GPUIX has no native folder-picker API (checked the `remorses/gpuix` source directly — only `onFileDrop` exists). Registering a Project is therefore done by dragging its folder from Finder onto the app window, not a "Browse..." dialog.

**Considered**: plain async functions + thrown errors (rejected — ADR 0001 already implies typed, composable domain errors are worth having; Effect gives us that without hand-rolling a Result type); a native macOS folder dialog via `osascript` (rejected for now — adds a shell-out for a capability drag-and-drop already covers; revisit if user feedback wants a Browse button).
