/** Slack limits an app's name to 35 characters and its bot's to 80. */
const APP_NAME_LIMIT = 35;
const BOT_NAME_LIMIT = 80;

/** A YAML scalar: plain when that is unambiguous, otherwise quoted. */
function scalar(value: string) {
  return /^[A-Za-z0-9][A-Za-z0-9 ._-]*$/.test(value) && !/ $/.test(value)
    ? value
    : JSON.stringify(value);
}

/**
 * The Slack app manifest a bot needs: Socket Mode, the `/home` command, and
 * the scopes and events Raphie uses. Keep it the same as the manifest in the
 * Slack guide; a test compares them.
 */
export function slackManifest(botName?: string) {
  const name = botName?.trim() || "Raphie";
  return `display_information:
  name: ${scalar(name.slice(0, APP_NAME_LIMIT).trim())}
features:
  app_home:
    messages_tab_enabled: true
    messages_tab_read_only_enabled: false
  bot_user:
    display_name: ${scalar(name.slice(0, BOT_NAME_LIMIT).trim())}
    always_online: true
  slash_commands:
    - command: /home
      description: Send this bot's scheduled updates here
      should_escape: false
oauth_config:
  scopes:
    bot:
      - app_mentions:read
      - channels:history
      - chat:write
      - commands
      - files:write
      - groups:history
      - im:history
      - users:read
settings:
  event_subscriptions:
    bot_events:
      - app_mention
      - message.channels
      - message.groups
      - message.im
  interactivity:
    is_enabled: true
  socket_mode_enabled: true
`;
}
