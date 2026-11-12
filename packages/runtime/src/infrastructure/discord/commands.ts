/** Upsert only Raphie's command, preserving other commands on the application. */
export async function registerDiscordCommands(
  config: {
    applicationId: string;
    botToken: string;
    apiUrl?: string;
  },
  request: typeof fetch = fetch,
) {
  try {
    const response = await request(
      `${config.apiUrl ?? "https://discord.com/api/v10"}/applications/${encodeURIComponent(config.applicationId)}/commands`,
      {
        method: "POST",
        headers: {
          Authorization: `Bot ${config.botToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: "home",
          description: "Use this conversation for scheduled updates",
          type: 1,
          integration_types: [0],
          contexts: [0, 1],
        }),
        redirect: "error",
        signal: AbortSignal.timeout(15_000),
      },
    );
    if (!response.ok) throw new Error();
  } catch {
    throw new Error(
      "Discord command registration failed. Check the bot permissions and reconnect.",
    );
  }
}
