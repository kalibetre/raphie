import { Gateway } from '../src/gateway.ts';

const app = await Gateway.open({ directory: process.argv[2], beforeEffectCommit: async () => {
  process.stdout.write('effect-written\n');
  await new Promise(() => {});
} });
const id = await app.accept({ source: 'web', eventId: 'crash-test', actor: 'owner', text: 'Persist this exact note', files: [] });
await app.decide(id, 'approved', 'owner', 'web');
