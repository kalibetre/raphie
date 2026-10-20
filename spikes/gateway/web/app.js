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
  const listKey = JSON.stringify([selected, state.conversations, sending]);
  if (listKey !== listVersion) {
    const list = document.querySelector('#conversations'); list.replaceChildren();
    if (!state.conversations.length) list.append(element('p', 'Your conversations will appear here.', 'empty'));
    for (const saved of [...state.conversations].reverse()) {
      const button = element('button', undefined, 'conversation-link'); button.type = 'button';
      button.append(element('span', saved.title), element('small', saved.discordThreadId ? 'Discord' : 'Web'));
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
  const serialized = JSON.stringify([selected, turns]);
  if (serialized !== previous) {
    transcript.replaceChildren();
    if (!turns.length && valid) transcript.append(element('p', 'A thought, a question, a detail to remember. Start anywhere.', 'empty'));
    for (const turn of turns) {
      const item = element('article', undefined, 'exchange');
      const date = new Date(turn.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      item.append(element('p', `YOU / ${turn.source.toUpperCase()} · ${date}`, 'message-meta'), element('p', turn.text, 'message-text'));
      const reply = element('div', undefined, 'assistant-reply');
      reply.append(element('p', 'RAPHIE', 'message-meta'), element('p', turn.answer ?? (turn.status === 'pending'
        ? 'Thinking…' : 'I couldn’t complete that reply. Check the service and model configuration, then send a new message.'), 'message-text'));
      item.append(reply); transcript.append(item);
    }
    previous = serialized;
  }
  const uncertain = state.deliveries.filter(d => d.status === 'uncertain' && turns.some(t => t.id === d.turnId));
  document.querySelector('#deliveries').textContent = uncertain.length ? 'A Discord delivery needs checking. The reply is saved here; automatic resend is paused to avoid duplicates.' : '';
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
