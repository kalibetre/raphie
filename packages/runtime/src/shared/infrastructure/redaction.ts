const registeredSecrets = new Set<string>();

export function registerRedactionSecret(secret: string) {
  if (secret) registeredSecrets.add(secret);
}

// Redact before persistence, including values accidentally embedded in error text.
export function redact(value: unknown): string {
  const secrets = [
    "OPENROUTER_API_KEY",
    "MCP_BEARER_TOKEN",
    "DISCORD_BOT_TOKEN",
  ]
    .map((key) => process.env[key])
    .filter((v): v is string => !!v);
  let text =
    JSON.stringify(value, (key, val) =>
      /authorization|api.?key|token|secret|password/i.test(key) &&
      !/tokens|tokenCount/i.test(key)
        ? "[redacted]"
        : val,
    ) ?? "null";
  for (const secret of [...secrets, ...registeredSecrets])
    text = text.replaceAll(secret, "[redacted]");
  return text.length > 24_000
    ? JSON.stringify({ preview: text.slice(0, 24_000), truncated: true })
    : text;
}
