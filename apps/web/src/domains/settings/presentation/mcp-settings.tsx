import type { BotMcpConnection, SaveMcpConnection } from "@raphie/contracts";
import { useState } from "react";

import { Button } from "../../../shared/ui/button";
import { Input } from "../../../shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "../../../shared/ui/select";
import { useBotAutomation } from "../infrastructure/use-bot-automation";
import { Group, Row } from "./settings-group";
import { SettingsStatus } from "./settings-status";
import { useSettingsGuard } from "./use-settings-guard";

export function McpSettings() {
  const data = useBotAutomation<BotMcpConnection>("mcp");
  const [name, setName] = useState("");
  const [transport, setTransport] = useState<"http" | "stdio">("http");
  const [address, setAddress] = useState("");
  const [token, setToken] = useState("");
  const [args, setArgs] = useState("");
  const [env, setEnv] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const pending = data.mutation.isPending;
  const dirty =
    !!(name || address || token || args || env) || transport !== "http";
  const guard = useSettingsGuard(dirty, pending);

  function discard() {
    setTransport("http");
    setName("");
    setAddress("");
    setToken("");
    setArgs("");
    setEnv("");
    setError("");
  }

  async function connect() {
    setError("");
    setMessage("");
    try {
      const input: SaveMcpConnection = { name, transport };
      if (transport === "http") {
        input.url = address;
        if (token) input.token = token;
      } else {
        input.command = address;
        const argumentsValue: unknown = JSON.parse(args || "[]");
        if (
          !Array.isArray(argumentsValue) ||
          !argumentsValue.every((a) => typeof a === "string")
        )
          throw new Error("Arguments must be a JSON array of strings.");
        input.args = argumentsValue;
        const environment: unknown = JSON.parse(env || "{}");
        if (
          !environment ||
          typeof environment !== "object" ||
          Array.isArray(environment)
        )
          throw new Error(
            "Environment must be a JSON object of string values.",
          );
        const values: Record<string, string> = {};
        for (const [key, value] of Object.entries(environment)) {
          if (typeof value !== "string")
            throw new Error("Environment values must be strings.");
          values[key] = value;
        }
        input.env = values;
      }
      const result = await data.mutation.mutateAsync({ input });
      discard();
      setMessage(
        result.items.some((item) => item.authorizationUrl)
          ? "Server added. Choose Authorize to sign in and grant access."
          : "Connected. These tools are available only to this bot.",
      );
    } catch (cause) {
      setError(
        cause instanceof SyntaxError
          ? "Check the arguments and environment JSON."
          : cause instanceof Error
            ? cause.message
            : "Could not connect MCP.",
      );
    }
  }

  async function change(
    id: string,
    action: "enable" | "disable" | "remove" | "import",
  ) {
    setError("");
    try {
      await data.mutation.mutateAsync({ id, input: { action } });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Could not update MCP.",
      );
    }
  }

  if (!data.data)
    return (
      <SettingsStatus
        title="MCP tools"
        message={
          data.error
            ? "Could not load MCP connections."
            : "Loading connections…"
        }
        onRetry={data.error ? () => void data.refetch() : undefined}
      />
    );
  return (
    <>
      <Group
        title="Connected servers"
        note="Tools are discovered as needed. Tool actions require your approval; connections are not shared with other bots."
      >
        {data.data.items.some(
          (connection) => connection.source === "environment",
        ) && (
          <p className="automation-note">
            Import saves an encrypted copy for this bot. After import, host
            environment edits are ignored, even if you remove the saved
            connection. Your environment files stay unchanged.
          </p>
        )}
        {data.data.items.length ? (
          data.data.items.map((connection) => (
            <Row
              key={connection.id}
              title={connection.name}
              description={`${connection.authorizationUrl ? "Authorization required" : connection.authorizationFailed ? "Authorization did not complete · reconnect to retry" : connection.connected ? `${connection.toolCount} tools` : connection.enabled ? "Disconnected · reconnect to retry" : "Paused"} · ${connection.transport === "http" ? "Streamable HTTP" : "Local command"} · ${connection.address}`}
            >
              <div className="automation-actions">
                {connection.authorizationUrl && (
                  <a
                    className="underline underline-offset-4"
                    href={connection.authorizationUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`Authorize ${connection.name} (opens a new tab)`}
                  >
                    Authorize
                  </a>
                )}
                {connection.source === "environment" ? (
                  <>
                    <span>Environment configuration · default bot only</span>
                    <Button
                      disabled={pending}
                      onClick={() => void change(connection.id, "import")}
                    >
                      Import encrypted copy
                    </Button>
                  </>
                ) : (
                  <>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={pending}
                      onClick={() =>
                        void change(
                          connection.id,
                          connection.connected || connection.authorizationUrl
                            ? "disable"
                            : "enable",
                        )
                      }
                    >
                      {connection.connected
                        ? "Pause"
                        : connection.authorizationUrl
                          ? "Cancel authorization"
                          : connection.enabled
                            ? "Reconnect"
                            : "Enable"}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={pending}
                      onClick={() => void change(connection.id, "remove")}
                    >
                      Remove
                    </Button>
                  </>
                )}
              </div>
            </Row>
          ))
        ) : (
          <Row
            title="No MCP servers yet"
            description="Connect a server below to give this bot access to its tools."
          />
        )}
      </Group>
      <Group
        title="Add a connection"
        note="Credentials are encrypted on the runtime. To change a server's configuration, remove it and add its replacement."
      >
        <form
          className="settings-form automation-form"
          onSubmit={(event) => {
            event.preventDefault();
            void connect();
          }}
        >
          <label htmlFor="mcp-name">Connection name</label>
          <Input
            id="mcp-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            required
            maxLength={80}
            placeholder="My project tools"
          />
          <label htmlFor="mcp-transport">Transport</label>
          <Select
            value={transport}
            onValueChange={(value) => {
              if (value === "http" || value === "stdio") {
                setTransport(value);
                setAddress("");
                setToken("");
                setArgs("");
                setEnv("");
              }
            }}
          >
            <SelectTrigger id="mcp-transport">
              <SelectValue>
                {transport === "http"
                  ? "Streamable HTTP"
                  : "Local command (stdio)"}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="http">Streamable HTTP</SelectItem>
              <SelectItem value="stdio">Local command (stdio)</SelectItem>
            </SelectContent>
          </Select>
          <label htmlFor="mcp-address">
            {transport === "http" ? "Server URL" : "Command"}
          </label>
          <Input
            id="mcp-address"
            type={transport === "http" ? "url" : "text"}
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            required
            placeholder={
              transport === "http" ? "https://tools.example.com/mcp" : "npx"
            }
          />
          {transport === "http" ? (
            <>
              <p className="automation-note">
                Leave the token empty for automatic browser authorization when
                the server supports OAuth. After connecting, choose Authorize
                above to sign in.
              </p>
              <label htmlFor="mcp-token">Bearer token (optional)</label>
              <Input
                id="mcp-token"
                type="password"
                autoComplete="off"
                value={token}
                onChange={(e) => setToken(e.target.value)}
              />
            </>
          ) : (
            <>
              <p className="automation-note">
                Local commands run on the runtime host with its permissions.
              </p>
              <label htmlFor="mcp-args">Arguments (JSON array)</label>
              <Input
                id="mcp-args"
                value={args}
                onChange={(e) => setArgs(e.target.value)}
                placeholder={'["-y", "your-mcp-server"]'}
              />
              <label htmlFor="mcp-env">
                Environment (JSON object, optional)
              </label>
              <Input
                id="mcp-env"
                type="password"
                autoComplete="off"
                value={env}
                onChange={(e) => setEnv(e.target.value)}
                placeholder={'{"API_TOKEN":"…"}'}
              />
            </>
          )}
          {(error || guard.message) && (
            <p role="alert" className="settings-error">
              {error || guard.message}
            </p>
          )}
          {message && (
            <p role="status" className="automation-note">
              {message}
            </p>
          )}
          <div className="automation-actions">
            <Button
              type="submit"
              disabled={pending || !name.trim() || !address.trim()}
            >
              {pending ? "Connecting…" : "Connect server"}
            </Button>
            <Button
              type="button"
              variant="ghost"
              disabled={pending || !dirty}
              onClick={discard}
            >
              Discard
            </Button>
          </div>
        </form>
      </Group>
    </>
  );
}
