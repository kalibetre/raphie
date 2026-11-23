import type { SaveOwnerProfile } from "@raphie/contracts";
import { useMemo, useState } from "react";

import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select";
import { Textarea } from "../../../shared/ui/textarea";
import {
  rulesOf,
  rulesProblem,
  rulesText,
  sameRules,
} from "../application/rules";
import { useOwner } from "../infrastructure/use-owner";
import { RulesField } from "./rules-field";
import { SaveBar } from "./save-bar";
import { useSettingsGuard } from "./use-settings-guard";

const NOT_SET = "none";

type Draft = Omit<SaveOwnerProfile, "rules"> & {
  /** The rules as they are edited, one a line. */
  rules: string;
};

const same = (a: Draft, b: Draft) =>
  a.name === b.name &&
  a.callMe === b.callMe &&
  a.timeZone === b.timeZone &&
  a.about === b.about &&
  sameRules(rulesOf(a.rules), rulesOf(b.rules));

/** This device's time zone, offered when the owner has not chosen one. */
const deviceZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

/** Settings → You: who every bot is talking to. */
export function OwnerSettings() {
  const owner = useOwner();
  const [message, setMessage] = useState("");
  if (owner.isError)
    return (
      <p role="alert" className="settings-error">
        Could not load your profile. Reload to try again.
      </p>
    );
  if (!owner.data) return <p role="status">Loading…</p>;
  const { updatedAt, ...saved } = owner.data;
  // A new key after each save starts the form from what was saved.
  return (
    <OwnerForm
      key={updatedAt ?? 0}
      saved={saved}
      message={message}
      onMessage={setMessage}
    />
  );
}

function OwnerForm({
  saved,
  message,
  onMessage,
}: {
  saved: SaveOwnerProfile;
  message: string;
  onMessage: (message: string) => void;
}) {
  const owner = useOwner();
  const start: Draft = { ...saved, rules: rulesText(saved.rules ?? []) };
  const [draft, setDraft] = useState<Draft>(start);
  const problem = rulesProblem(rulesOf(draft.rules));
  const setMessage = onMessage;
  const zones = useMemo(() => Intl.supportedValuesOf("timeZone"), []);
  const dirty = !same(draft, start);
  const pending = owner.save.isPending;
  const guard = useSettingsGuard(dirty, pending);
  const set = (patch: Partial<Draft>) => {
    setMessage("");
    setDraft((current) => ({ ...current, ...patch }));
  };
  const here = deviceZone();

  async function save() {
    setMessage("");
    try {
      await owner.save.mutateAsync({
        name: draft.name.trim(),
        callMe: draft.callMe.trim(),
        timeZone: draft.timeZone,
        about: draft.about.trim(),
        rules: rulesOf(draft.rules),
      });
      setMessage("Saved. Every bot uses it from its next reply.");
    } catch {
      // The save bar shows the error.
    }
  }

  return (
    <form
      className="bot-editor"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <section className="bot-editor-section" aria-label="You">
        <h2>You</h2>
        <p>
          Every bot knows this about you. It describes you and grants nothing.
        </p>
        <div className="bot-form settings-form">
          <label htmlFor="owner-name">Name</label>
          <Input
            id="owner-name"
            maxLength={80}
            placeholder="Your name"
            value={draft.name}
            disabled={pending}
            onChange={(e) => set({ name: e.target.value })}
          />
          <label htmlFor="owner-call-me">What bots call you</label>
          <Input
            id="owner-call-me"
            maxLength={40}
            placeholder={draft.name.split(" ")[0] || "A first name or nickname"}
            value={draft.callMe}
            disabled={pending}
            onChange={(e) => set({ callMe: e.target.value })}
          />
          <label htmlFor="owner-time-zone">Time zone</label>
          <div className="owner-time-zone">
            <Select
              value={draft.timeZone || NOT_SET}
              disabled={pending}
              onValueChange={(value) =>
                set({ timeZone: value === NOT_SET ? "" : String(value) })
              }
            >
              <SelectTrigger id="owner-time-zone">
                <SelectValue>
                  {(value: string) =>
                    value === NOT_SET ? "Not set" : value.replaceAll("_", " ")
                  }
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NOT_SET}>Not set</SelectItem>
                {zones.map((zone) => (
                  <SelectItem key={zone} value={zone}>
                    {zone.replaceAll("_", " ")}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {draft.timeZone !== here && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={pending}
                onClick={() => set({ timeZone: here })}
              >
                Use {here.replaceAll("_", " ")}
              </Button>
            )}
          </div>
          <p>
            Bots see the time of each message here, so “tomorrow at 9” means
            your 9.
          </p>
        </div>
      </section>
      <section className="bot-editor-section" aria-label="About you">
        <h2>About you</h2>
        <p>
          A few lines every bot should know: your work, your days, how you like
          to be helped.
        </p>
        <div className="bot-form settings-form">
          <label htmlFor="owner-about" className="sr-only">
            About you
          </label>
          <Textarea
            id="owner-about"
            className="owner-about min-h-40 text-sm leading-relaxed"
            maxLength={2000}
            placeholder="I run a small design studio. Mornings are for deep work, so keep anything non-urgent until after lunch."
            value={draft.about}
            disabled={pending}
            onChange={(e) => set({ about: e.target.value })}
          />
          <p>
            {draft.about.length.toLocaleString()} / 2,000 · Don’t put passwords
            or keys here.
          </p>
        </div>
      </section>
      <RulesField
        id="owner-rules"
        title="Rules for every bot"
        note="What you want done every time, whichever bot you are talking to. Each bot reads these in every conversation, before its own rules."
        placeholder={
          "Give times on a 12-hour clock, in my time zone.\nLeave all-day events out of my schedule."
        }
        value={draft.rules}
        pending={pending}
        onChange={(rules) => set({ rules })}
      />
      <SaveBar
        visible={dirty || pending || !!message || owner.save.isError}
        status={guard.message || message || (dirty ? "Unsaved changes" : "")}
        error={
          owner.save.error instanceof Error ? owner.save.error.message : ""
        }
        pending={pending}
        canSave={dirty && !pending && !problem}
        canDiscard={dirty && !pending}
        onDiscard={() => {
          setDraft(start);
          setMessage("");
        }}
      />
    </form>
  );
}
