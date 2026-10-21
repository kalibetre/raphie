import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { discordRenderer } from "../src/infrastructure/discord/delivery.ts";

const app = await Gateway.open({ directory: process.argv[2]! });
const operation = await app.deliveries.claim(discordRenderer(app.files));
if (!operation) throw new Error("Missing delivery operation");
if (process.argv[3] === "true")
  await app.deliveries.settle(operation.id, "platform-first");
process.stdout.write("first-chunk\n");
await new Promise(() => {});
