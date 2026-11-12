import type { BotProfile } from "@raphie/contracts";
import { useState } from "react";

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
import { ScrollArea } from "../../../shared/ui/scroll-area";

export function DeleteBot({
  profile,
  disabled,
  pending,
  onDelete,
}: {
  profile: BotProfile;
  disabled: boolean;
  pending: boolean;
  onDelete: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [confirmation, setConfirmation] = useState("");
  const [error, setError] = useState("");

  async function remove() {
    setError("");
    try {
      await onDelete();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not delete this bot.",
      );
    }
  }

  return (
    <section className="grid gap-3 border-t pt-6">
      <h2 className="text-base font-medium">Delete bot</h2>
      <p className="text-sm text-muted-foreground">
        Permanently remove this bot and all its local data. Save or discard
        profile changes first.
      </p>
      <Button
        type="button"
        variant="destructive"
        className="justify-self-start"
        disabled={disabled}
        onClick={() => {
          setConfirmation("");
          setError("");
          setOpen(true);
        }}
      >
        Delete bot…
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!pending) setOpen(next);
        }}
      >
        <DialogContent
          showCloseButton={!pending}
          className="flex max-h-[calc(100dvh-2rem)] flex-col"
        >
          <ScrollArea className="min-h-0" viewportLabel="Deletion details">
            <div className="grid gap-4 p-1">
              <DialogHeader>
                <DialogTitle className="break-words pr-6 leading-snug">
                  Delete {profile.name}?
                </DialogTitle>
                <DialogDescription>
                  This permanently removes its profile history, conversations,
                  attachments, local memory, connections, scheduled jobs and
                  workspace files. This cannot be undone.
                </DialogDescription>
              </DialogHeader>
              <p className="text-sm text-muted-foreground">
                External memory and messages stay in their services. Provider
                keys are not revoked. Backups are not erased.
              </p>
              <label className="grid gap-2 text-sm">
                <span className="break-words">
                  Type <strong>{profile.name}</strong> to confirm
                </span>
                <Input
                  value={confirmation}
                  onChange={(event) => setConfirmation(event.target.value)}
                  disabled={pending}
                  autoComplete="off"
                />
              </label>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
            </div>
          </ScrollArea>
          <DialogFooter className="shrink-0">
            <Button
              type="button"
              variant="outline"
              disabled={pending}
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={pending || confirmation !== profile.name}
              onClick={() => void remove()}
            >
              {pending ? "Deleting…" : "Permanently delete bot"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}
