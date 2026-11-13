import type {
  ChannelSettings,
  TelegramChannel,
  TelegramPairingCode,
  TelegramProblem,
} from "@raphie/contracts";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Send, TriangleAlert } from "lucide-react";
import { useState } from "react";

import { useBackend } from "../../../infrastructure/http/backend-context";
import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import { Switch } from "../../../shared/ui/switch";
import { Row } from "./settings-group";
import { useSettingsGuard } from "./use-settings-guard";

const problems: Record<TelegramProblem, string> = {
  conflict:
    "Telegram reports another poller or webhook for this bot. Remove the webhook or stop the other poller.",
  token: "Telegram rejected the saved token. Enter a new token and save.",
  network: "Cannot reach Telegram right now. Raphie keeps retrying.",
  duplicate:
    "This Telegram bot is connected to another Raphie bot. Remove it there first.",
};

function describe(saved: TelegramChannel | null) {
  if (!saved) return "Not configured";
  if (!saved.enabled) return "Disabled · token saved";
  if (saved.problem) return `Disconnected · ${problems[saved.problem]}`;
  const accounts = saved.verifiedUserIds.length;
  return `Connected as @${saved.botUsername} · ${
    accounts
      ? `${accounts} verified account${accounts === 1 ? "" : "s"}`
      : "no verified account yet"
  }`;
}

export function TelegramSettings({ saved }: { saved: TelegramChannel | null }) {
  const { workspace } = useBackend();
  const client = useQueryClient();
  const mutation = useMutation({
    mutationFn: ({ path, input }: { path: string; input: unknown }) =>
      workspace.api<ChannelSettings["telegram"] | TelegramPairingCode>(
        path,
        input,
      ),
  });
  const [token, setToken] = useState("");
  const [expanded, setExpanded] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [pairing, setPairing] = useState<TelegramPairingCode | null>(null);
  const guard = useSettingsGuard(token !== "", mutation.isPending);

  async function run<T>(
    path: string,
    input: unknown,
    done: (result: T) => void,
    failure: string,
  ) {
    setError("");
    setMessage("");
    try {
      done((await mutation.mutateAsync({ path, input })) as T);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : failure);
    }
  }

  // Every state-changing call returns the new settings; keep the shared cache current.
  const update = (message: string) => (result: { telegram?: unknown }) => {
    client.setQueryData<ChannelSettings>(["channels"], (current) => ({
      discord: current?.discord ?? null,
      telegram: (result as ChannelSettings).telegram,
    }));
    setMessage(message);
  };

  const visibleCode =
    pairing && saved?.pairingExpiresAt === pairing.expiresAt ? pairing : null;

  return (
    <>
      <Row
        icon={<Send size={18} />}
        title="Telegram"
        description={describe(saved)}
      >
        <Button
          variant="outline"
          size="sm"
          type="button"
          disabled={mutation.isPending}
          aria-expanded={expanded}
          aria-controls="telegram-settings"
          onClick={() => {
            if (expanded && token) {
              setError("Save your changes or choose Cancel to discard them.");
              return;
            }
            setError("");
            setMessage("");
            setExpanded(!expanded);
          }}
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
        <div id="telegram-settings" className="channel-settings">
          <p className="automation-note">
            Create a bot with @BotFather in Telegram and paste its token here.
            The token is encrypted on the runtime host and is never shown again.
            Raphie uses long polling, so nothing is exposed to the internet.
          </p>
          <form
            className="settings-form automation-form channel-form"
            onSubmit={(event) => {
              event.preventDefault();
              void run<{ telegram?: unknown }>(
                "/api/channels/telegram",
                { botToken: token || undefined },
                (result) => {
                  update("Telegram connected.")(result);
                  setToken("");
                },
                "Could not connect Telegram.",
              );
            }}
          >
            <div className="channel-field channel-field-wide">
              <label htmlFor="telegram-token">
                Bot token {saved ? "(leave blank to keep)" : ""}
              </label>
              <Input
                id="telegram-token"
                type="password"
                autoComplete="off"
                required={!saved}
                value={token}
                onChange={(event) => setToken(event.target.value)}
              />
            </div>
            <div className="automation-actions channel-field-wide">
              <Button
                type="submit"
                disabled={mutation.isPending || (!!saved && !token)}
              >
                {mutation.isPending ? "Saving…" : "Save and connect"}
              </Button>
              {saved && (
                <Button
                  type="button"
                  variant="ghost"
                  disabled={mutation.isPending}
                  onClick={() =>
                    void run<{ telegram?: unknown }>(
                      "/api/channels/telegram/remove",
                      {},
                      (result) => {
                        update("Telegram removed from this bot.")(result);
                        setPairing(null);
                        setExpanded(false);
                      },
                      "Could not remove Telegram.",
                    )
                  }
                >
                  Remove Telegram
                </Button>
              )}
              <Button
                type="button"
                variant="ghost"
                disabled={mutation.isPending}
                onClick={() => {
                  setToken("");
                  setError("");
                  setExpanded(false);
                }}
              >
                Cancel
              </Button>
            </div>
          </form>
          {saved && (
            <div className="telegram-section">
              <div className="telegram-toggle">
                <div>
                  <h4>Receive messages</h4>
                  <p className="automation-note">
                    Turn off to stop polling without losing the token or
                    verified accounts.
                  </p>
                </div>
                <Switch
                  aria-label="Receive Telegram messages"
                  checked={saved.enabled}
                  disabled={mutation.isPending}
                  onCheckedChange={(enabled) =>
                    void run<{ telegram?: unknown }>(
                      "/api/channels/telegram",
                      { enabled },
                      update(
                        enabled ? "Telegram enabled." : "Telegram disabled.",
                      ),
                      "Could not change Telegram.",
                    )
                  }
                />
              </div>
              <h4>Verified accounts</h4>
              <p className="automation-note">
                Only these Telegram accounts can message this bot or decide tool
                approvals. Identity is the account&apos;s numeric ID, not its
                username. In groups, only verified owners can trigger replies by
                mentioning this bot or using /ask@BotName. Pair privately; group
                tool approvals are decided in the web workspace.
              </p>
              {saved.verifiedUserIds.length === 0 ? (
                <p className="automation-note">
                  No verified account yet. Nobody can use this bot until you
                  pair your account below.
                </p>
              ) : (
                saved.verifiedUserIds.map((id) => (
                  <div key={id} className="channel-user-row">
                    <span className="telegram-user-id">{id}</span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      disabled={mutation.isPending}
                      aria-label={`Revoke Telegram account ${id}`}
                      onClick={() =>
                        void run<{ telegram?: unknown }>(
                          "/api/channels/telegram/unpair",
                          { userId: id },
                          update("Telegram account revoked."),
                          "Could not revoke the account.",
                        )
                      }
                    >
                      Revoke
                    </Button>
                  </div>
                ))
              )}
              <div className="automation-actions">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={
                    mutation.isPending || !saved.enabled || !saved.connected
                  }
                  onClick={() =>
                    void run<TelegramPairingCode>(
                      "/api/channels/telegram/pairing",
                      {},
                      (code) => {
                        setPairing(code);
                        void client.invalidateQueries({
                          queryKey: ["channels"],
                        });
                      },
                      "Could not create a pairing code.",
                    )
                  }
                >
                  Create pairing code
                </Button>
              </div>
              {visibleCode && (
                <div className="telegram-pairing" role="status">
                  <span className="telegram-code">{visibleCode.code}</span>
                  <p className="automation-note">
                    Open a private chat with @{saved.botUsername} and send{" "}
                    <strong>/pair {visibleCode.code}</strong>. The code works
                    once and expires at{" "}
                    {new Date(visibleCode.expiresAt).toLocaleTimeString()}.
                    Raphie does not show it again.
                  </p>
                </div>
              )}
            </div>
          )}
          {(error || guard.message) && (
            <div className="channel-alert" role="alert">
              <span className="channel-alert-icon" aria-hidden="true">
                <TriangleAlert size={18} />
              </span>
              <div className="channel-alert-copy">
                <strong>Telegram settings need attention</strong>
                <p>{error || guard.message}</p>
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}
