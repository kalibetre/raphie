// Deterministic OpenAI-compatible model; all requested tools still execute in real VMs.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const server = createServer(async (request, response) => {
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') {
    response.writeHead(404).end();
    return;
  }
  try {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 2_000_000) throw new Error('Request too large');
    }
    const input = JSON.parse(body);
    const messages = input.messages ?? [];
    const userIndex = messages.findLastIndex(message => message.role === 'user');
    const toolResults = messages.slice(userIndex + 1).filter(message => message.role === 'tool');
    let delta;
    let reason;
    if (toolResults.length) {
      delta = { content: toolResults.map(message => typeof message.content === 'string'
        ? message.content : JSON.stringify(message.content)).join('\n') };
      reason = 'stop';
    } else {
      const content = messages[userIndex]?.content;
      const text = typeof content === 'string' ? content
        : (content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');
      const encoded = text.match(/RAPHIE_COMMAND (\{[^\n]+\})/);
      if (!encoded) throw new Error('Expected a deterministic RAPHIE_COMMAND');
      const tool = input.tools?.find(tool => tool.function.name === 'bash');
      if (!tool) throw new Error('Eve did not expose the bash tool');
      delta = { tool_calls: [{ index: 0, id: `call_${randomUUID()}`, type: 'function',
        function: { name: tool.function.name, arguments: JSON.stringify(JSON.parse(encoded[1])) } }] };
      reason = 'tool_calls';
    }
    const common = { id: `chatcmpl-${randomUUID()}`, created: Math.floor(Date.now() / 1000),
      model: 'raphie-deterministic' };
    const usage = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
    if (input.stream) {
      response.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' });
      const send = (delta, finish_reason, usage) => response.write(`data: ${JSON.stringify({
        ...common, object: 'chat.completion.chunk', choices: [{ index: 0, delta, finish_reason }],
        ...(usage ? { usage } : {}),
      })}\n\n`);
      send({ role: 'assistant', ...delta }, null);
      send({}, reason, usage);
      response.end('data: [DONE]\n\n');
    } else {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ ...common, object: 'chat.completion', usage,
        choices: [{ index: 0, message: { role: 'assistant', ...delta }, finish_reason: reason }] }));
    }
  } catch (error) {
    console.error(String(error));
    response.writeHead(400, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ error: { message: String(error) } }));
  }
});
server.listen(4311, '127.0.0.1', () => console.log('Deterministic model listening on 127.0.0.1:4311'));
process.on('SIGTERM', () => server.close());
