import type {
  ChannelSettings,
  SaveSlackChannel,
  SlackChannel,
} from "@raphie/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Hash } from "lucide-react";
import { useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { ChannelAlert } from "./channel-alert";
import { Row } from "./settings-group";
import { useSettingsGuard } from "./use-settings-guard";

type Draft = Partial<SaveSlackChannel>;

function describe(saved: SlackChannel | null) {
  if (!saved) return "Not configured";
  if (saved.conflict) return "Disconnected · Slack app used by another bot";
  if (!saved.connected) return "Disconnected · save settings to reconnect";
  return saved.teamName ? `Connected to ${saved.teamName}` : "Connected";
}

export function SlackSettings({ saved }: { saved: SlackChannel | null }) {
  const { workspace } = useBackend();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ path, input }: { path: string; input: unknown }) =>
      workspace.api<Pick<ChannelSettings, "slack">>(path, input),
    // Each call returns only Slack's settings; keep the other channels cached.
    onSuccess: ({ slack }) =>
      client.setQueryData<ChannelSettings>(["channels"], (current) =>
        current ? { ...current, slack } : current,
      ),
  });
  const [draft, setDraft] = useState<Draft>({});
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const guard = useSettingsGuard(
    Object.keys(draft).length > 0,
    mutation.isPending,
  );
  const userIds = draft.allowedUserIds ?? saved?.allowedUserIds ?? [];
  const channelId = draft.channelId ?? saved?.channelId ?? "";

  async function run(path: string, input: unknown, done: string) {
    setError("");
    setMessage("");
    try {
      await mutation.mutateAsync({ path, input });
      setDraft({});
      setMessage(done);
      setExpanded(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update Slack.",
      );
    }
  }

  function close() {
    if (Object.keys(draft).length) {
      setError("Save your changes or choose Cancel to discard them.");
      return;
    }
    setError("");
    setExpanded(false);
  }

  return (
    <>
      <Row
        icon={<Hash size={18} />}
        title="Slack"
        description={describe(saved)}
      >
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={mutation.isPending}
          aria-expanded={expanded}
          aria-controls="slack-settings"
          onClick={() =>
            expanded ? close() : (setMessage(""), setExpanded(true))
          }
        >
          {expanded ? "Close" : saved ? "Manage" : "Connect"}
        </Button>
      </Row>
      {message && (
        <p role="status" className="channel-message">
          {message}
        </p>
      )}
      {expanded && (
        <div id="slack-settings" className="channel-settings">
          <p className="automation-note">
            Raphie connects through Socket Mode, so nothing is exposed to the
            internet. Both tokens are encrypted on the runtime host and are
            never shown again. Leave a token blank to keep the saved one.
          </p>
          {saved?.conflict && !error && (
            <ChannelAlert
              title="Slack app already in use"
              message="This Slack app is connected to another bot. Remove it from that bot first, then save here to connect, or remove it from this bot."
            />
          )}
          <form
            className="settings-form automation-form channel-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run(
                "/api/channels/slack",
                {
                  botToken: draft.botToken || undefined,
                  appToken: draft.appToken || undefined,
                  allowedUserIds: userIds
                    .map((id) => id.trim())
                    .filter(Boolean),
                  channelId,
                },
                "Slack settings saved.",
              );
            }}
          >
            <div className="channel-field channel-field-wide">
              <label htmlFor="slack-bot-token">
                Bot token {saved ? "(leave blank to keep)" : ""}
              </label>
              <p className="automation-note">
                Create an app at{" "}
                <a
                  className="underline underline-offset-4"
                  href="https://api.slack.com/apps"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Slack API apps (opens in a new tab)"
                >
                  api.slack.com/apps
                </a>
                , install it to your workspace, then copy its bot token
                (xoxb-…).
              </p>
              <Input
                id="slack-bot-token"
                type="password"
                autoComplete="off"
                required={!saved}
                value={draft.botToken ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, botToken: e.target.value })
                }
              />
            </div>
            <div className="channel-field channel-field-wide">
              <label htmlFor="slack-app-token">
                App-level token {saved ? "(leave blank to keep)" : ""}
              </label>
              <p className="automation-note">
                Turn on Socket Mode and create an app-level token with the
                connections:write scope (xapp-…).
              </p>
              <Input
                id="slack-app-token"
                type="password"
                autoComplete="off"
                required={!saved}
                value={draft.appToken ?? ""}
                onChange={(e) =>
                  setDraft({ ...draft, appToken: e.target.value })
                }
              />
            </div>
            <div className="channel-field channel-field-wide">
              <label>Allowed Slack member IDs</label>
              <p className="automation-note">
                Only these members can message this bot, and only the member who
                started an action can approve it. If the list is empty, nobody
                can use it.
              </p>
              {userIds.map((id, index) => (
                <div key={index} className="channel-user-row">
                  <Input
                    aria-label={`Allowed Slack member ID ${index + 1}`}
                    autoCapitalize="characters"
                    value={id}
                    onChange={(e) =>
                      setDraft({
                        ...draft,
                        allowedUserIds: userIds.map((item, i) =>
                          i === index ? e.target.value : item,
                        ),
                      })
                    }
                  />
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    aria-label={`Remove member ID ${index + 1}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        allowedUserIds: userIds.filter((_, i) => i !== index),
                      })
                    }
                  >
                    Remove
                  </Button>
                </div>
              ))}
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={userIds.length >= 100}
                onClick={() =>
                  setDraft({ ...draft, allowedUserIds: [...userIds, ""] })
                }
              >
                Add member ID
              </Button>
            </div>
            <div className="channel-field channel-field-wide">
              <label htmlFor="slack-channel">Channel ID (optional)</label>
              <Input
                id="slack-channel"
                autoCapitalize="characters"
                value={channelId}
                onChange={(e) =>
                  setDraft({ ...draft, channelId: e.target.value })
                }
              />
              <p className="automation-note">
                Leave blank to allow direct messages and @mentions in any
                channel the app is in. Set a channel ID to restrict access to
                that channel and its threads.
              </p>
            </div>
            {(error || guard.message) && (
              <div className="channel-field-wide">
                <ChannelAlert
                  title="Slack settings need attention"
                  message={error || guard.message}
                />
              </div>
            )}
            <div className="automation-actions channel-field-wide">
              <Button type="submit" disabled={mutation.isPending}>
                {mutation.isPending ? "Saving…" : "Save and connect"}
              </Button>
              {saved && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={mutation.isPending}
                  onClick={() =>
                    void run(
                      "/api/channels/slack/remove",
                      {},
                      "Slack removed from this bot.",
                    )
                  }
                >
                  Remove Slack
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                disabled={mutation.isPending}
                onClick={() => {
                  setDraft({});
                  setError("");
                  setExpanded(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
        </div>
      )}
    </>
  );
}
