# Raphie (Environment Vault)

A native desktop GUI and CLI for managing project environment profiles without placing `.env` files in projects or worktrees.

## Language

**Project**:
A registered codebase identity with one or more local folders. A Project may be a git repository or a non-git folder.
_Avoid_: Repo, app, workspace

**Project ID**:
A stable internal identifier assigned to a Project. It is distinct from the user-facing Project handle and remains stable when a registered folder moves.
_Avoid_: Slug, project name

**Project handle**:
A user-chosen, unique CLI selector for a Project, such as `agent-barn`. It is stable independently of the folder's basename.
_Avoid_: Display name, folder name

**Profile**:
A named, complete snapshot of a Project's environment variables, such as `local`, `staging`, or `production`. Profiles are independently editable by the user and are not layered overrides.
_Avoid_: Environment, overlay, template

**Vault**:
Raphie's encrypted local store of Projects, Profiles, and their environment values. The Vault is the source of truth; no `.env` file is required in a Project or Worktree.
_Avoid_: Central env file, config file

**Worktree**:
A git checkout belonging to a Project, including its main checkout and additional `git worktree` checkouts. A Worktree is a location from which a Project Profile may be selected and run; it does not contain environment values managed by Raphie.
_Avoid_: Checkout, clone

**EnvVar**:
A single string key/value pair in a Profile. Values are masked by default in the UI and are injected only into a launched process when that Profile is run.
_Avoid_: Secret, setting (unless specifically referring to a sensitive value)
