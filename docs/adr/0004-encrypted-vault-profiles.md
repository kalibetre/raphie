---
status: accepted
---

# Encrypted vault profiles and process-scoped execution

Raphie will replace central `.env` files and Worktree symlinks with one password-protected local SQLite Vault containing complete, user-editable Profiles for each Project. The Vault derives an AES-GCM key from the user's password with a per-Vault salt; the password is never stored. On first launch the application initializes the Vault after password confirmation. Unlocking stores the derived key (never the password) in the operating system credential store with a fixed one-hour expiry, so the GUI and each separate CLI invocation share one unlock; locking, or the expiry, removes it and the Vault stays locked until the password is entered again.

When a Project is registered, Raphie checks whether the selected folder already contains `.env`. If it does, the user may skip import, import the complete snapshot while keeping the source, or import and delete the source after the encrypted write succeeds. Raphie never creates a replacement `.env` for Vault-backed Projects.

The CLI's primary execution interface is `raphie run [--project HANDLE] [--profile NAME] -- <command>`: it resolves the current Project or an explicit Project handle and injects the selected Profile only into the launched process, rather than attempting to mutate the parent shell. Encrypted export/import across machines is a planned Vault capability.

This supersedes ADR-0001 because file sharing is no longer the source-of-truth model; the Vault is.
