# Raphie (Env Variable Manager)

A native desktop GUI for managing `.env` files across multiple local projects and their git worktrees, replacing manual symlink scripts with a click-driven UI.

## Language

**Project**:
A registered folder on disk that the app manages env values for. Not required to be a git repo.
_Avoid_: Repo, app, workspace

**Project ID**:
A short UUID assigned to a Project at registration, stable even if the Project is renamed or its folder moves. The app's local state (`projects.json`) maps a Project ID to its display name, folder path, and Central env file location.
_Avoid_: Slug, project name (the name is user-editable and not used for storage paths)

**Worktree**:
A git checkout belonging to a Project — includes the Project's main checkout as well as any additional `git worktree` checkouts. Only applies when the Project is a git repo.
_Avoid_: Checkout, clone

**Central env file**:
The single real `.env` file per Project that holds the source-of-truth values, stored outside the repo (e.g. under `~/.config/...`). Worktrees point at it rather than holding their own copy.
_Avoid_: Master env, source env

**Link**:
The user-triggered action of symlinking a Worktree's `.env` to its Project's Central env file. Manual per worktree, not auto-detected.
_Avoid_: Sync, connect, bind

**EnvVar**:
A single key/value pair inside a Central env file. Values are masked by default in the UI.
_Avoid_: Secret, setting (unless specifically referring to a sensitive value)
