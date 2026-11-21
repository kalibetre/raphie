import type { SkillDetail, SkillSummary } from "@raphie/contracts";
import { Plus, Upload } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "../../../shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "../../../shared/ui/dialog";
import { Input } from "../../../shared/ui/input";
import { Switch } from "../../../shared/ui/switch";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "../../../shared/ui/tabs";
import { Textarea } from "../../../shared/ui/textarea";
import { useSkill, useSkills } from "../infrastructure/use-skills";
import { SaveBar } from "./save-bar";
import { Group, Row } from "./settings-group";
import { SettingsStatus } from "./settings-status";
import { useSettingsGuard } from "./use-settings-guard";

const TEMPLATE = `---
name: my-skill
description: What this skill does, and when to use it.
---

# My skill

1. The first step.
2. The next step.
`;

const message = (error: unknown, fallback: string) =>
  error instanceof Error ? error.message : fallback;

/** The `name:` in a SKILL.md's frontmatter, as the runtime will read it. */
function skillName(text: string) {
  const front = /^﻿?---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? "";
  return /^name:\s*["']?([^"'\r\n]*?)["']?\s*$/m.exec(front)?.[1] ?? "";
}

export type SkillView =
  { mode: "list" } | { mode: "edit"; name: string } | { mode: "new" };

/**
 * Asked before the page header's "Skills" link leaves an editor: false
 * keeps the editor open, which it does while it holds unsaved edits.
 */
export type SkillLeave = { current: (() => boolean) | null };

/** The page header for a view: an open skill names itself. */
export function skillHeader(view: SkillView) {
  if (view.mode === "edit")
    return {
      title: view.name,
      lede: `skills/${view.name}/ in this bot's workspace.`,
    };
  if (view.mode === "new")
    return {
      title: "New skill",
      lede: "The name in SKILL.md becomes the folder: lowercase letters, digits and hyphens.",
    };
  return null;
}

/** Settings → Skills: what this bot knows how to do, kept in its workspace. */
export function SkillSettings({
  view,
  onView,
  leaveRef,
}: {
  view: SkillView;
  onView: (view: SkillView) => void;
  leaveRef: SkillLeave;
}) {
  const setView = onView;
  if (view.mode === "new")
    return (
      <SkillEditor
        leaveRef={leaveRef}
        onDone={() => setView({ mode: "list" })}
      />
    );
  if (view.mode === "edit")
    return (
      <LoadedEditor
        name={view.name}
        leaveRef={leaveRef}
        onDone={() => setView({ mode: "list" })}
      />
    );
  return (
    <SkillList
      onNew={() => setView({ mode: "new" })}
      onEdit={(name) => setView({ mode: "edit", name })}
    />
  );
}

function SkillList({
  onNew,
  onEdit,
}: {
  onNew: () => void;
  onEdit: (name: string) => void;
}) {
  const skills = useSkills();
  const [importing, setImporting] = useState(false);
  const [error, setError] = useState("");
  if (!skills.list.data)
    return (
      <SettingsStatus
        title="Skills"
        message={
          skills.list.error ? "Could not load skills." : "Loading skills…"
        }
        onRetry={
          skills.list.error ? () => void skills.list.refetch() : undefined
        }
      />
    );
  const items = skills.list.data.items;
  const on = items.filter((skill) => skill.enabled && !skill.problem).length;
  return (
    <>
      <Group
        title="Skills"
        note={
          items.length
            ? `${items.length} ${items.length === 1 ? "skill" : "skills"} · ${on} on. The bot reads a skill when a task matches its description.`
            : "Instructions for particular tasks, read only when a task needs them."
        }
        action={
          <div className="automation-actions">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setImporting(true)}
            >
              <Upload aria-hidden="true" />
              Import
            </Button>
            <Button size="sm" onClick={onNew}>
              <Plus aria-hidden="true" />
              New skill
            </Button>
          </div>
        }
      >
        {items.length ? (
          items.map((skill) => (
            <SkillRow
              key={skill.name}
              skill={skill}
              pending={skills.enable.isPending}
              onEdit={() => onEdit(skill.name)}
              onToggle={(enabled) => {
                setError("");
                skills.enable
                  .mutateAsync({ name: skill.name, enabled })
                  .catch((cause: unknown) =>
                    setError(message(cause, "Could not change the skill.")),
                  );
              }}
            />
          ))
        ) : (
          <Row
            title="No skills yet"
            description="Write one, or import a skill folder as a .zip or from GitHub. The bot can also write its own in skills/ in its workspace."
          />
        )}
      </Group>
      {error && (
        <p role="alert" className="settings-error">
          {error}
        </p>
      )}
      <Group
        title="How skills work"
        note="Each skill is a folder in this bot's workspace, skills/<name>/, holding a SKILL.md in the standard Agent Skills format. The bot sees every skill's name and description, reads a whole skill only when a task matches, and runs its scripts in the sandbox. Skills never grant tools or permissions."
      />
      <ImportDialog open={importing} onOpenChange={setImporting} />
    </>
  );
}

function SkillRow({
  skill,
  pending,
  onEdit,
  onToggle,
}: {
  skill: SkillSummary;
  pending: boolean;
  onEdit: () => void;
  onToggle: (enabled: boolean) => void;
}) {
  return (
    <Row
      title={skill.name}
      description={
        <>
          {skill.problem ? (
            <span className="skill-problem">{skill.problem}</span>
          ) : (
            skill.description
          )}
          <span className="skill-files">{skill.files.join(" · ")}</span>
        </>
      }
    >
      <div className="automation-actions">
        <Button variant="ghost" size="sm" onClick={onEdit}>
          Edit
        </Button>
        <Switch
          aria-label={`Use ${skill.name}`}
          checked={skill.enabled && !skill.problem}
          disabled={pending || !!skill.problem}
          onCheckedChange={(checked) => onToggle(checked)}
        />
      </div>
    </Row>
  );
}

function LoadedEditor({
  name,
  leaveRef,
  onDone,
}: {
  name: string;
  leaveRef: SkillLeave;
  onDone: () => void;
}) {
  const skill = useSkill(name);
  if (!skill.data)
    return (
      <SettingsStatus
        title={name}
        message={skill.error ? "Could not load this skill." : "Loading skill…"}
        onRetry={skill.error ? () => void skill.refetch() : undefined}
      />
    );
  return <SkillEditor saved={skill.data} leaveRef={leaveRef} onDone={onDone} />;
}

type Draft = { path: string; text: string }[];

const draftOf = (saved?: SkillDetail): Draft =>
  saved
    ? saved.contents.flatMap((file) =>
        file.text === null ? [] : [{ path: file.path, text: file.text }],
      )
    : [{ path: "SKILL.md", text: TEMPLATE }];

/** A skill's text files: SKILL.md and anything it bundles. */
function SkillEditor({
  saved,
  leaveRef,
  onDone,
}: {
  saved?: SkillDetail;
  leaveRef: SkillLeave;
  onDone: () => void;
}) {
  const skills = useSkills();
  const [draft, setDraft] = useState<Draft>(() => draftOf(saved));
  const [open, setOpen] = useState("SKILL.md");
  const [newPath, setNewPath] = useState("");
  const [status, setStatus] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const original = JSON.stringify(draftOf(saved));
  const dirty = JSON.stringify(draft) !== original;
  const pending = skills.save.isPending || skills.remove.isPending;
  const guard = useSettingsGuard(dirty, pending);
  const current = draft.find((file) => file.path === open) ?? draft[0]!;
  const name = saved?.name ?? skillName(draft[0]?.text ?? "");
  const binaries = saved?.contents.filter((file) => file.text === null) ?? [];
  useEffect(() => {
    leaveRef.current = () => {
      if (dirty || pending) setStatus("Save or discard your changes first.");
      return !dirty && !pending;
    };
    return () => {
      leaveRef.current = null;
    };
  }, [leaveRef, dirty, pending]);

  const edit = (text: string) => {
    setStatus("");
    setDraft((files) =>
      files.map((file) =>
        file.path === current.path ? { ...file, text } : file,
      ),
    );
  };

  async function save() {
    setStatus("");
    try {
      await skills.save.mutateAsync({
        name,
        input: { files: draft },
        create: !saved,
      });
      if (!saved) onDone();
      else setStatus("Saved. The bot uses it from its next message.");
    } catch {
      // The save bar shows the error.
    }
  }

  return (
    <form
      className="skill-editor-page"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <div className="settings-card">
        <div className="skill-editor">
          <nav className="skill-files-nav" aria-label="Skill files">
            {draft.map((file) => (
              <button
                key={file.path}
                type="button"
                className="skill-file"
                aria-current={file.path === current.path ? "true" : undefined}
                onClick={() => setOpen(file.path)}
              >
                {file.path}
              </button>
            ))}
            {binaries.map((file) => (
              <span key={file.path} className="skill-file skill-file-binary">
                {file.path}
              </span>
            ))}
            <div className="skill-add-file">
              <Input
                aria-label="New file path"
                placeholder="references/notes.md"
                value={newPath}
                disabled={pending}
                onChange={(event) => setNewPath(event.target.value)}
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={
                  pending ||
                  !newPath.trim() ||
                  draft.some((file) => file.path === newPath.trim())
                }
                onClick={() => {
                  const path = newPath.trim();
                  setDraft((files) => [...files, { path, text: "" }]);
                  setOpen(path);
                  setNewPath("");
                }}
              >
                Add file
              </Button>
            </div>
          </nav>
          <div className="skill-file-editor">
            <div className="skill-file-bar">
              <span>{current.path}</span>
              {current.path !== "SKILL.md" && (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={pending}
                  onClick={() => {
                    setDraft((files) =>
                      files.filter((file) => file.path !== current.path),
                    );
                    setOpen("SKILL.md");
                  }}
                >
                  Remove file
                </Button>
              )}
            </div>
            <Textarea
              aria-label={current.path}
              className="skill-text rounded-none border-0 bg-transparent shadow-none focus-visible:ring-0 dark:bg-transparent"
              spellCheck={false}
              value={current.text}
              disabled={pending}
              onChange={(event) => edit(event.target.value)}
            />
          </div>
        </div>
        {binaries.length > 0 && (
          <p className="automation-note skill-binary-note">
            Files that are not text are kept as they are; change them in the
            workspace.
          </p>
        )}
      </div>
      {saved && (
        <Group
          title="Delete skill"
          note="Removes the skill's folder from the workspace."
          action={
            <Button
              type="button"
              variant="destructive"
              size="sm"
              disabled={pending}
              onClick={() => setConfirmDelete(true)}
            >
              Delete…
            </Button>
          }
        />
      )}
      <Dialog open={confirmDelete} onOpenChange={setConfirmDelete}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {saved?.name}?</DialogTitle>
            <DialogDescription>
              Its folder and every file in it are removed from the workspace.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="destructive"
              disabled={pending}
              onClick={() => {
                if (!saved) return;
                skills.remove
                  .mutateAsync(saved.name)
                  .then(onDone)
                  .catch((cause: unknown) => {
                    setConfirmDelete(false);
                    setStatus(message(cause, "Could not delete the skill."));
                  });
              }}
            >
              Delete skill
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
      <SaveBar
        visible={!saved || dirty || pending || !!status || skills.save.isError}
        status={
          guard.message ||
          status ||
          (dirty ? "Unsaved changes" : saved ? "" : "A new skill")
        }
        error={
          skills.save.error instanceof Error ? skills.save.error.message : ""
        }
        pending={pending}
        canSave={(dirty || !saved) && !pending && !!name}
        canDiscard={dirty && !pending}
        label={saved ? "Save changes" : "Create skill"}
        onDiscard={() => {
          setDraft(draftOf(saved));
          setOpen("SKILL.md");
          setStatus("");
        }}
      />
    </form>
  );
}

/** Import from a .zip of skill folders, or from a GitHub folder link. */
function ImportDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const skills = useSkills();
  const [tab, setTab] = useState("zip");
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState("");
  const [replace, setReplace] = useState(false);
  const [error, setError] = useState("");
  const pending = skills.importSkills.isPending;

  async function run() {
    setError("");
    try {
      await skills.importSkills.mutateAsync(
        tab === "zip" ? { file: file!, replace } : { url: url.trim(), replace },
      );
      setFile(null);
      setUrl("");
      onOpenChange(false);
    } catch (cause) {
      setError(message(cause, "Could not import."));
    }
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(next) => {
        if (!pending) onOpenChange(next);
      }}
    >
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Import skills</DialogTitle>
          <DialogDescription>
            Every folder with a SKILL.md becomes a skill in this bot's
            workspace.
          </DialogDescription>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(value) => setTab(String(value))}>
          <TabsList>
            <TabsTrigger value="zip">.zip file</TabsTrigger>
            <TabsTrigger value="github">GitHub link</TabsTrigger>
          </TabsList>
          <TabsContent value="zip" className="skill-import">
            <Input
              type="file"
              accept=".zip,.skill,application/zip"
              aria-label="Skill archive"
              disabled={pending}
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
            <p className="automation-note">Up to 8 MiB.</p>
          </TabsContent>
          <TabsContent value="github" className="skill-import">
            <Input
              type="url"
              aria-label="GitHub link"
              placeholder="https://github.com/owner/repo/tree/main/skills/pdf"
              value={url}
              disabled={pending}
              onChange={(event) => setUrl(event.target.value)}
            />
            <p className="automation-note">
              A public repository, or a folder in one.
            </p>
          </TabsContent>
        </Tabs>
        <label className="skill-replace">
          <Switch
            checked={replace}
            disabled={pending}
            onCheckedChange={(checked) => setReplace(checked)}
          />
          Replace skills with the same name
        </label>
        {error && (
          <p role="alert" className="settings-error">
            {error}
          </p>
        )}
        <DialogFooter>
          <Button
            disabled={pending || (tab === "zip" ? !file : !url.trim().length)}
            onClick={() => void run()}
          >
            {pending ? "Importing…" : "Import"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
