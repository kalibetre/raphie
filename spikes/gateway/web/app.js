const transcript = document.querySelector('#conversation');
const form = document.querySelector('#composer');
const errorBox = document.querySelector('#error');
const messageInput = document.querySelector('#message');
let selected = new URL(location.href).searchParams.get('conversation');
selected = selected ? Number(selected) : null;
let eventId = crypto.randomUUID();
let latest;
let previous = '';
let listVersion = '';
let approvalsVersion = '';
let refreshing = false;
let sending = false;
const drafts = new Map();

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function showError(message) { errorBox.textContent = message; errorBox.hidden = !message; }
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'x-raphie-client': 'web', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function select(id) {
  if (sending) return;
  drafts.set(selected, { text: messageInput.value, eventId });
  selected = id;
  messageInput.value = drafts.get(id)?.text ?? '';
  eventId = drafts.get(id)?.eventId ?? crypto.randomUUID();
  const url = new URL(location.href);
  if (id === null) url.searchParams.delete('conversation'); else url.searchParams.set('conversation', String(id));
  history.replaceState(null, '', url);
  showError(''); previous = ''; listVersion = '';
  if (latest) render(latest);
  messageInput.focus();
}
function render(state) {
  latest = state;
  const active = state.conversations.find(c => c.id === selected);
  const valid = selected === null || !!active;
  const approvals = state.toolApprovals ?? [];
  const listKey = JSON.stringify([selected, state.conversations, sending, approvals.filter(a => a.status === 'pending').map(a => a.conversationId)]);
  if (listKey !== listVersion) {
    const list = document.querySelector('#conversations'); list.replaceChildren();
    if (!state.conversations.length) list.append(element('p', 'Your conversations will appear here.', 'empty'));
    for (const saved of [...state.conversations].reverse()) {
      const button = element('button', undefined, 'conversation-link'); button.type = 'button';
      const awaiting = approvals.some(a => a.conversationId === saved.id && a.status === 'pending');
      button.append(element('span', saved.title), element('small', `${saved.discordThreadId ? 'Discord' : 'Web'}${awaiting ? ' · Approval needed' : ''}`));
      if (saved.id === selected) button.setAttribute('aria-current', 'page');
      button.disabled = sending;
      button.onclick = () => select(saved.id); list.append(button);
    }
    listVersion = listKey;
  }
  document.querySelector('#new-conversation').disabled = sending;
  document.querySelector('#model').textContent = state.model ? state.model.modelId : 'MODEL NOT CONFIGURED';
  document.querySelector('#conversation-title').textContent = active?.title ?? (valid ? 'What’s on your mind?' : 'Conversation not found');
  document.querySelector('#conversation-source').textContent = active ? (active.discordThreadId ? 'STARTED IN DISCORD' : 'STARTED ON THE WEB') : 'A FRESH START';
  document.querySelector('#conversation-hint').textContent = active?.discordThreadId
    ? 'Continue here or in the same Discord thread. Replies appear in both places.'
    : 'Talk it through with Raphie. Your conversation will be here when you return.';
  const setup = document.querySelector('#setup'); setup.hidden = !!state.model;
  setup.textContent = 'Chat needs OpenRouter configuration on the server. Set OPENROUTER_API_KEY and restart Raphie.';
  messageInput.disabled = sending || !state.model || !valid;
  document.querySelector('#send').disabled = sending || !state.model || !valid;
  const turns = state.turns.filter(t => t.conversationId === selected);
  const proposals = approvals.filter(a => a.conversationId === selected);
  document.querySelector('#mcp-status').textContent = state.mcp?.connected
    ? `${state.mcp.server} connected · ${state.mcp.toolCount} tools · executions need approval`
    : state.mcp?.error ? 'MCP connection failed · chat is available without external tools' : 'No MCP server connected';
  const serialized = JSON.stringify([selected, turns, proposals.filter(a => a.status === 'pending').map(a => a.id)]);
  if (serialized !== previous) {
    transcript.replaceChildren();
    if (!turns.length && valid) transcript.append(element('p', 'A thought, a question, a detail to remember. Start anywhere.', 'empty'));
    for (const turn of turns) {
      const item = element('article', undefined, 'exchange');
      const date = new Date(turn.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      item.append(element('p', `YOU / ${turn.source.toUpperCase()} · ${date}`, 'message-meta'), element('p', turn.text, 'message-text'));
      const reply = element('div', undefined, 'assistant-reply');
      reply.append(element('p', 'RAPHIE', 'message-meta'), element('p', turn.answer ?? (turn.status === 'pending'
        ? (proposals.some(a => a.status === 'pending') ? 'Waiting for your tool approval below…' : 'Thinking…')
        : 'I couldn’t complete that reply. Check the service and model configuration, then send a new message.'), 'message-text'));
      item.append(reply); transcript.append(item);
    }
    previous = serialized;
  }
  const approvalsKey = JSON.stringify([selected, proposals]);
  if (approvalsKey !== approvalsVersion) {
    const container = document.querySelector('#tool-approvals'); container.replaceChildren();
    for (const proposal of proposals) {
      const card = element('article', undefined, `approval tool-approval ${proposal.status}`);
      const status = proposal.status === 'pending' ? 'Needs your approval'
        : proposal.execution === 'uncertain' ? 'Outcome unknown · check the external service'
        : proposal.execution === 'done' ? 'Call finished'
        : proposal.execution === 'running' ? 'Executing approved call…'
        : { approved: 'Approved · waiting to execute', rejected: 'Declined', expired: 'Approval expired' }[proposal.status];
      card.append(element('p', `${proposal.server} / ${proposal.tool}`, 'message-meta'), element('h2', status),
        element('p', 'Approval permits one call with these exact arguments. Code may read or change external data.'));
      const details = element('details');
      details.open = proposal.status === 'pending';
      details.append(element('summary', 'Review exact arguments'), element('pre', proposal.argumentsJson, 'tool-arguments'));
      const download = element('a', 'Download full request JSON'); download.href = `/api/tool-approvals/${proposal.id}.json`;
      download.setAttribute('download', ''); card.append(details, download);
      if (proposal.status === 'pending') {
        card.append(element('p', `Expires at ${new Date(proposal.expiresAt).toLocaleTimeString()}`));
        const actions = element('div', undefined, 'actions');
        for (const [decision, label] of [['approved', 'Approve once'], ['rejected', 'Decline']]) {
          const button = element('button', label, decision === 'approved' ? 'primary' : 'secondary'); button.type = 'button';
          button.setAttribute('aria-label', `${label}: ${proposal.tool} (${proposal.id.slice(0, 8)})`);
          button.onclick = async () => {
            for (const sibling of actions.children) sibling.disabled = true;
            try {
              await request(`/api/tool-approvals/${proposal.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }) });
              showError(''); await refresh(); messageInput.focus();
            } catch (error) { showError(error.message); for (const sibling of actions.children) sibling.disabled = false; }
          };
          actions.append(button);
        }
        card.append(actions);
      } else if (proposal.decidedVia) card.append(element('p', `Decision recorded via ${proposal.decidedVia}.`));
      container.append(card);
    }
    approvalsVersion = approvalsKey;
  }
  const uncertain = state.deliveries.filter(d => d.status === 'uncertain' && turns.some(t => t.id === d.turnId));
  const uncertainApproval = proposals.some(p => state.uncertainToolDeliveries?.includes(p.id));
  document.querySelector('#deliveries').textContent = uncertain.length || uncertainApproval ? 'A Discord delivery needs checking. The request and reply are saved here; automatic resend is paused to avoid duplicates.' : '';
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try { render(await request('/api/chats')); document.querySelector('#connection').textContent = '● Service connected'; }
  catch { document.querySelector('#connection').textContent = 'Service offline · reconnecting'; }
  finally { refreshing = false; }
}
document.querySelector('#new-conversation').onclick = () => select(null);
messageInput.addEventListener('input', () => { eventId = crypto.randomUUID(); });
form.addEventListener('submit', async event => {
  event.preventDefault();
  const text = messageInput.value;
  if (!text.trim() || sending) return;
  sending = true; if (latest) render(latest);
  try {
    const result = await request('/api/chat', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ text, eventId, ...(selected === null ? {} : { conversationId: selected }) }) });
    drafts.delete(selected); messageInput.value = ''; sending = false;
    select(result.conversationId); await refresh(); showError('');
  } catch (error) { showError(`${error.message} Your message is still here; you can retry.`); }
  finally { sending = false; if (latest) render(latest); messageInput.focus(); }
});
await refresh();
setInterval(refresh, 1000);
