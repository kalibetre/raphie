import { defineTool } from 'eve/tools';
import { z } from 'zod';

// Stands in for Gmail/Calendar/CRM/etc. The sim points this at a local mock with latency and errors.
const base = process.env.INTEGRATION_BASE ?? 'http://127.0.0.1:4311/integration';

export default defineTool({
  description: 'Call an external integration (calendar, email, crm) and return its JSON.',
  inputSchema: z.object({ service: z.enum(['calendar', 'email', 'crm']), path: z.string() }),
  async execute({ service, path }) {
    for (let attempt = 0; ; attempt++) {
      const response = await fetch(`${base}/${service}${path}`);
      if (response.ok) return await response.json();
      if (attempt >= 1) return { error: `HTTP ${response.status}` };
    }
  },
});
