// Deterministic OpenAI-compatible model + mock external integrations. Zero real tokens, zero real services.
// User message may carry RAPHIE_COMMAND {command} (one bash call) or RAPHIE_PLAN [{tool,args}, ...] (sequential calls).
// Anything else (e.g. compaction) gets a short plain-text reply.
import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';

const stats = { modelRequests: 0, promptTokens: 0, completionTokens: 0, integrationCalls: 0, integrationErrors: 0, systemChars: 0, toolSchemaChars: 0, conversationChars: 0 };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function integration(url, response) {
  stats.integrationCalls++;
  await sleep(50 + Math.random() * 250); // external API latency
  if (Math.random() < 0.02) {
    stats.integrationErrors++;
    return response.writeHead(503).end('unavailable');
  }
  const items = Array.from({ length: 5 }, (_, i) => ({ id: i, title: `item ${i} from ${url.split('/')[2]}`, body: 'x'.repeat(120) }));
  response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ items }));
}

const server = createServer(async (request, response) => {
  if (request.url === '/stats') return response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(stats));
  if (request.url.startsWith('/integration/')) return integration(request.url, response);
  if (request.url !== '/v1/chat/completions' || request.method !== 'POST') return response.writeHead(404).end();
  try {
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 20_000_000) throw new Error('Request too large');
    }
    const input = JSON.parse(body);
    const messages = input.messages ?? [];
    const userIndex = messages.findLastIndex(message => message.role === 'user');
    const toolResults = messages.slice(userIndex + 1).filter(message => message.role === 'tool');
    const content = messages[userIndex]?.content;
    const text = typeof content === 'string' ? content
      : (content ?? []).filter(part => part.type === 'text').map(part => part.text).join('\n');
    const command = text.match(/RAPHIE_COMMAND (\{[^\n]+\})/);
    const plan = text.match(/RAPHIE_PLAN (\[[^\n]+\])/);
    const steps = plan ? JSON.parse(plan[1]) : command ? [{ tool: 'bash', args: JSON.parse(command[1]) }] : [];
    let delta;
    let reason;
    if (toolResults.length < steps.length) {
      const step = steps[toolResults.length];
      const tool = input.tools?.find(tool => tool.function.name === step.tool);
      if (!tool) throw new Error(`Eve did not expose tool ${step.tool}`);
      delta = { tool_calls: [{ index: 0, id: `call_${randomUUID()}`, type: 'function',
        function: { name: step.tool, arguments: JSON.stringify(step.args) } }] };
      reason = 'tool_calls';
    } else if (steps.length) {
      delta = { content: `done (${steps.length} steps)\n` + toolResults.slice(-1).map(m => String(typeof m.content === 'string' ? m.content : JSON.stringify(m.content)).slice(0, 200)).join('') };
      reason = 'stop';
    } else {
      delta = { content: 'Summary: routine scheduled work, nothing notable.' };
      reason = 'stop';
    }
    // Realistic usage for cost forecasting: ~4 chars per token of the prompt actually sent.
    const usage = { prompt_tokens: Math.ceil(body.length / 4), completion_tokens: 40,
      total_tokens: Math.ceil(body.length / 4) + 40 };
    const chars = value => JSON.stringify(value ?? '').length;
    stats.systemChars += messages.filter(m => m.role === 'system').reduce((n, m) => n + chars(m.content), 0);
    stats.toolSchemaChars += chars(input.tools);
    stats.conversationChars += messages.filter(m => m.role !== 'system').reduce((n, m) => n + chars(m.content), 0);
    stats.modelRequests++;
    stats.promptTokens += usage.prompt_tokens;
    stats.completionTokens += usage.completion_tokens;
    const common = { id: `chatcmpl-${randomUUID()}`, created: Math.floor(Date.now() / 1000), model: 'raphie-deterministic' };
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
