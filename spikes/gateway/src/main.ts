import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { Gateway } from './gateway.ts';
import { startServer } from './server.ts';
import { createDiscordBridge, resolveDiscordThread } from './discord.ts';
import { createModels } from '@earendil-works/pi-ai/models';
import { openrouterProvider } from '@earendil-works/pi-ai/providers/openrouter';

const keys = ['DISCORD_BOT_TOKEN', 'DISCORD_APPLICATION_ID', 'DISCORD_PUBLIC_KEY', 'DISCORD_OWNER_ID', 'DISCORD_CHANNEL_ID'] as const;
const configured = keys.filter(key => process.env[key]);
if (configured.length && configured.length !== keys.length) throw new Error('Set all five Discord configuration values, or leave all unset.');
const port = Number(process.env.PORT ?? 4315);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Invalid PORT.');
const channelId = process.env.DISCORD_CHANNEL_ID;
const threadId = channelId ? await resolveDiscordThread({
  botToken: process.env.DISCORD_BOT_TOKEN!, channelId, guildId: process.env.DISCORD_GUILD_ID,
}) : undefined;
const models = createModels();
models.setProvider(openrouterProvider());
const modelId = process.env.RAPHIE_MODEL ?? 'anthropic/claude-haiku-5.5';
if (!models.getModel('openrouter', modelId)) throw new Error('RAPHIE_MODEL is not in the installed OpenRouter model catalog.');
const model = process.env.OPENROUTER_API_KEY ? { provider: 'openrouter', modelId } : undefined;
const app = await Gateway.open({ directory: resolve(process.env.DATA_DIRECTORY ?? '.data'), discordThreadId: threadId, models, model });
const discord = threadId ? createDiscordBridge(app, {
  botToken: process.env.DISCORD_BOT_TOKEN!, applicationId: process.env.DISCORD_APPLICATION_ID!,
  publicKey: process.env.DISCORD_PUBLIC_KEY!,
  ownerId: process.env.DISCORD_OWNER_ID!, threadId, respondToChannelIds: [channelId!],
}) : null;
const stop = new AbortController();
let flushing: Promise<void> = Promise.resolve();
let http: Awaited<ReturnType<typeof startServer>> | undefined;
let listener: Promise<void> = Promise.resolve();
try {
  await discord?.chat.initialize();
  http = await startServer(app, { port, discordConfigured: !!discord });
  console.log(`Raphie gateway: ${http.url}`);
  if (discord) {
    listener = discord.listen(stop.signal);
    flushing = (async () => {
      while (!stop.signal.aborted) {
        await discord.flush().catch(() => { console.error('Discord delivery pump failed.'); });
        await delay(1000, undefined, { signal: stop.signal }).catch(() => {});
      }
    })();
  }
  await new Promise<void>(done => {
    process.once('SIGINT', done); process.once('SIGTERM', done);
  });
} finally {
  stop.abort();
  await listener; await flushing; await http?.close(); await discord?.chat.shutdown(); await app.close();
}
