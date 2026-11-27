import type { WorkItem } from "@raphie/contracts";
import { Plus } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "../../../shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "../../../shared/ui/dialog";
import { Input } from "../../../shared/ui/input";
import { Textarea } from "../../../shared/ui/textarea";
import {
  changed,
  type Draft,
  type WorkChange,
} from "../application/work-draft";
import {
  useWorkCancel,
  useWorkChange,
  useWorkItems,
} from "../infrastructure/use-work-items";
import { Group } from "./settings-group";
import { SettingsStatus } from "./settings-status";
import { workItemAnchor, WorkItemCard } from "./work-item-card";

/**
 * A bot's work items: open ones first, then those it closed. `focus` is an
 * item a link asked for: once it is drawn, it is brought into view and
 * marked for a moment.
 */
export function WorkSettings({ bot, focus }: { bot: string; focus?: string }) {
  const open = useWorkItems(false);
  const closed = useWorkItems(true);
  const loaded = !!open.data && !!closed.data;
  useEffect(() => {
    if (!focus || !loaded) return;
    const target = document.getElementById(workItemAnchor(focus));
    if (!target) return;
    target.scrollIntoView({ block: "center" });
    target.dataset.focused = "true";
    const timer = window.setTimeout(() => delete target.dataset.focused, 1600);
    return () => window.clearTimeout(timer);
  }, [focus, loaded]);
  const change = useWorkChange();
  const cancel = useWorkCancel();
  const [draft, setDraft] = useState<Draft>();
  const [error, setError] = useState("");
  const pending = change.isPending || cancel.isPending;

  async function save(id: string | undefined, input: WorkChange) {
    setError("");
    try {
      await change.mutateAsync({ id, input });
      return true;
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not save this item.",
      );
      return false;
    }
  }

  if (!open.data)
    return (
      <SettingsStatus
        title="Work"
        message={open.error ? "Could not load work items." : "Loading work…"}
        onRetry={open.error ? () => void open.refetch() : undefined}
      />
    );
  const card = (item: WorkItem) => (
    <WorkItemCard
      key={item.id}
      item={item}
      bot={bot}
      pending={pending}
      onEdit={() =>
        setDraft({
          id: item.id,
          title: item.title,
          notes: item.notes,
          started: { title: item.title, notes: item.notes },
        })
      }
      onChange={(input) => void save(item.id, input)}
      onCancel={() =>
        void cancel
          .mutateAsync(item.id)
          .catch((cause: unknown) =>
            setError(
              cause instanceof Error
                ? cause.message
                : "Could not cancel the run.",
            ),
          )
      }
    />
  );
  return (
    <>
      <Group
        title="Open"
        note={`${bot} updates these as it works. Ask about any of them in the chat, or change one here.`}
        action={
          <Button size="sm" onClick={() => setDraft({ title: "", notes: "" })}>
            <Plus size={15} /> New item
          </Button>
        }
      >
        {open.data.items.length ? (
          open.data.items.map(card)
        ) : (
          <p className="automation-empty">
            Nothing open. {bot} opens an item when something you ask for will
            take longer than one reply.
          </p>
        )}
      </Group>
      <Group title="Done" note="Finished and dropped items, newest first.">
        {closed.data?.items.length ? (
          closed.data.items.map(card)
        ) : (
          <p className="automation-empty">Nothing closed yet.</p>
        )}
      </Group>
      {!draft && error && (
        <p role="alert" className="settings-error">
          {error}
        </p>
      )}
      <Dialog
        open={!!draft}
        onOpenChange={(next) => {
          if (!next && !pending) {
            setDraft(undefined);
            setError("");
          }
        }}
      >
        <DialogContent
          className="job-dialog sm:max-w-[560px]"
          showCloseButton={!pending}
        >
          <DialogHeader>
            <DialogTitle>{draft?.id ? "Edit item" : "New item"}</DialogTitle>
            <DialogDescription>
              {draft?.id
                ? `${bot} reads the title and notes the next time it works on this.`
                : `Something for ${bot} to keep track of. It sees new items with your next message.`}
            </DialogDescription>
          </DialogHeader>
          <form
            className="settings-form automation-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!draft) return;
              const change = changed(draft);
              // Nothing changed: nothing to send, so the bot's edits stay.
              if (!change) return setDraft(undefined);
              void save(draft.id, change).then(
                (saved) => saved && setDraft(undefined),
              );
            }}
          >
            <label htmlFor="work-title">Title</label>
            <Input
              id="work-title"
              value={draft?.title ?? ""}
              onChange={(e) =>
                setDraft((d) => d && { ...d, title: e.target.value })
              }
              required
              maxLength={80}
              placeholder="Flights to Lisbon"
            />
            <label htmlFor="work-notes">Notes</label>
            <Textarea
              id="work-notes"
              value={draft?.notes ?? ""}
              onChange={(e) =>
                setDraft((d) => d && { ...d, notes: e.target.value })
              }
              maxLength={2000}
              placeholder="What it is about, and anything to keep in mind."
            />
            {error && (
              <p role="alert" className="settings-error">
                {error}
              </p>
            )}
            <div className="automation-actions">
              <Button type="submit" disabled={pending || !draft?.title.trim()}>
                {draft?.id ? "Save" : "Add item"}
              </Button>
              <Button
                type="button"
                variant="ghost"
                disabled={pending}
                onClick={() => {
                  setDraft(undefined);
                  setError("");
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
