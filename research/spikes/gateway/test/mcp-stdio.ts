import { createInterface } from 'node:readline';
import { rpcResponse } from './mcp-fixture.ts';

for await (const line of createInterface({ input: process.stdin })) {
  const response = rpcResponse(JSON.parse(line));
  if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
}
