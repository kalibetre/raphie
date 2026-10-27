import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Group, Row } from "./settings-group";
import { SettingsStatus } from "./settings-status";
import { useSettingsGuard } from "./use-settings-guard";

type Discord = {
  allowedUserIds: string[];
  channelId: string;
  connected: boolean;
  tokenConfigured: boolean;
  conflict: boolean;
};

type Channels = { discord: Discord | null };

export function ChannelSettings() {
  const { workspace } = useBackend();
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ["channels"],
    queryFn: () => workspace.api<Channels>("/api/channels"),
  });
  const mutation = useMutation({
    mutationFn: ({ path, input }: { path: string; input: unknown }) =>
      workspace.api<Channels>(path, input),
    onSuccess: (data) => client.setQueryData(["channels"], data),
  });
  const [draft, setDraft] = useState<Partial<Discord> & { botToken?: string }>(
    {},
  );
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const guard = useSettingsGuard(
    Object.keys(draft).length > 0,
    mutation.isPending,
  );
  if (!query.data)
    return (
      <SettingsStatus
        title="Channels"
        message={query.error ? "Could not load channels." : "Loading channels…"}
        onRetry={query.error ? () => void query.refetch() : undefined}
      />
    );
  const saved = query.data.discord;
  const userIds = draft.allowedUserIds ?? saved?.allowedUserIds ?? [];
  const channelId = draft.channelId ?? saved?.channelId ?? "";

  async function save() {
    setError("");
    setMessage("");
    try {
      await mutation.mutateAsync({
        path: "/api/channels/discord",
        input: {
          allowedUserIds: userIds.map((id) => id.trim()).filter(Boolean),
          channelId,
          botToken: draft.botToken || undefined,
        },
      });
      setDraft({});
      setMessage("Discord settings saved.");
      setExpanded(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not connect Discord.",
      );
    }
  }

  async function remove() {
    setError("");
    setMessage("");
    try {
      await mutation.mutateAsync({
        path: "/api/channels/discord/remove",
        input: {},
      });
      setDraft({});
      setMessage("Discord removed from this bot.");
      setExpanded(false);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not remove Discord.",
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
    <Group
      title="Channels"
      note="Channels connect this bot to messaging services. Each bot has its own settings and conversations."
    >
      <Row
        icon={
          <svg
            viewBox="0 0 24 24"
            width="18"
            height="18"
            fill="currentColor"
            aria-hidden="true"
          >
            <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z" />
          </svg>
        }
        title="Discord"
        description={
          saved
            ? saved.conflict
              ? "Disconnected · application used by another bot"
              : saved.connected
                ? "Connected"
                : "Disconnected · save settings to reconnect"
            : "Not configured"
        }
      >
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={mutation.isPending}
          aria-expanded={expanded}
          aria-controls="discord-settings"
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
        <div id="discord-settings" className="channel-settings">
          <p className="automation-note">
            The bot token is encrypted on the runtime host and is never shown
            again. Leave it blank to keep the saved token.
          </p>
          {saved?.conflict && (
            <p role="alert" className="settings-error">
              This Discord application is configured for another bot. Remove it
              from that bot first, then save here to connect, or remove it from
              this bot.
            </p>
          )}
          <form
            className="settings-form automation-form channel-form"
            onSubmit={(event) => {
              event.preventDefault();
              void save();
            }}
          >
            <div className="channel-field channel-field-wide">
              <label htmlFor="discord-token">
                Bot token {saved ? "(leave blank to keep)" : ""}
              </label>
              <p className="automation-note">
                Create an application and bot in the{" "}
                <a
                  className="underline underline-offset-4"
                  href="https://discord.com/developers/applications"
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Discord Developer Portal (opens in a new tab)"
                >
                  Discord Developer Portal
                </a>
                , then copy its bot token here.
              </p>
              <Input
                id="discord-token"
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
              <label>Allowed Discord user IDs</label>
              <p className="automation-note">
                Only these users can message this bot. Discord approvals are
                limited to the user who initiated the action. If the list is
                empty, nobody can use it.
              </p>
              {userIds.map((id, index) => (
                <div key={index} className="channel-user-row">
                  <Input
                    aria-label={`Allowed Discord user ID ${index + 1}`}
                    inputMode="numeric"
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
                    aria-label={`Remove user ID ${index + 1}`}
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
                Add user ID
              </Button>
            </div>
            <div className="channel-field channel-field-wide">
              <label htmlFor="discord-channel">Channel ID (optional)</label>
              <Input
                id="discord-channel"
                inputMode="numeric"
                value={channelId}
                onChange={(e) =>
                  setDraft({ ...draft, channelId: e.target.value })
                }
              />
              <p className="automation-note">
                Leave blank to allow direct messages and mentions in servers
                where the bot is present. Set a channel ID to restrict access to
                that channel and its threads.
              </p>
            </div>
            {(error || guard.message) && (
              <p role="alert" className="settings-error channel-field-wide">
                {error || guard.message}
              </p>
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
                  onClick={() => void remove()}
                >
                  Remove Discord
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
    </Group>
  );
}
