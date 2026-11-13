import { Gateway } from "../src/bootstrap/agent-runtime.ts";
import { telegramRenderer } from "../src/infrastructure/telegram/delivery.ts";

// Claims the first chunk exactly as the real worker would, then waits to be killed.
const app = await Gateway.open({ directory: process.argv[2]! });
const operation = await app.deliveries
  .forConnection("telegram:1")
  .claim(telegramRenderer());
if (!operation) throw new Error("Missing delivery operation");
if (process.argv[3] === "true")
  await app.deliveries.settle(operation.id, "platform-first");
process.stdout.write("first-chunk\n");
await new Promise(() => {});
