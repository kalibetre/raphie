const conversation = document.querySelector('#conversation');
const form = document.querySelector('#composer');
const errorBox = document.querySelector('#error');
let previous = '';
let eventId = crypto.randomUUID();
let refreshing = false;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}
function filesList(files) {
  const list = element('ul', undefined, 'files');
  for (const file of files) {
    const item = element('li');
    const link = element('a', file.name);
    link.href = `/api/files/${file.id}`;
    link.setAttribute('download', '');
    item.append(link, element('small', `${Math.ceil(file.size / 1024)} KB`));
    list.append(item);
  }
  return list;
}
function showError(message) { errorBox.textContent = message; errorBox.hidden = !message; }
async function request(url, options = {}) {
  const response = await fetch(url, { ...options, headers: { 'x-raphie-client': 'web', ...options.headers } });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Request failed.');
  return data;
}
function render(state) {
  conversation.replaceChildren();
  if (!state.approvals.length) conversation.append(element('p', 'Your first message starts the experiment.', 'empty'));
  for (const approval of state.approvals) {
    const item = element('article', undefined, 'exchange');
    const date = new Date(approval.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    item.append(element('p', `YOU / ${approval.source.toUpperCase()} · ${date}`, 'message-meta'));
    if (approval.text) item.append(element('p', approval.text, 'message-text'));
    if (approval.files.length) item.append(filesList(approval.files));
    const card = element('div', undefined, `approval ${approval.status}`);
    const status = approval.completedAt ? 'Completed' : { pending: 'Needs your approval', approved: 'Creating your copy…', rejected: 'Declined', expired: 'Approval expired' }[approval.status];
    card.append(element('p', 'RAPHIE', 'message-meta'), element('h2', status));
    card.append(element('p', approval.files.length ? 'Create a copy of the attached files and deliver it to your connected interfaces.' : 'Create a text file containing this exact note and deliver it to your connected interfaces.'));
    if (approval.status === 'pending') {
      card.append(element('small', `Expires at ${new Date(approval.expiresAt).toLocaleTimeString()}`));
      const actions = element('div', undefined, 'actions');
      for (const [decision, label] of [['approved', 'Approve'], ['rejected', 'Decline']]) {
        const button = element('button', label, decision === 'approved' ? 'primary' : 'secondary');
        button.type = 'button';
        button.setAttribute('aria-label', `${label} request from ${date}`);
        button.onclick = async () => {
          for (const sibling of actions.children) sibling.disabled = true;
          try {
            await request(`/api/approvals/${approval.id}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ decision }) });
            showError(''); await refresh(); document.querySelector('#message').focus();
          } catch (error) { showError(error.message); for (const sibling of actions.children) sibling.disabled = false; }
        };
        actions.append(button);
      }
      card.append(actions);
    } else if (approval.decidedVia) card.append(element('small', `Decision recorded via ${approval.decidedVia}.`));
    if (approval.results.length) card.append(filesList(approval.results));
    item.append(card); conversation.append(item);
  }
  const uncertain = state.deliveries.filter(d => d.status === 'uncertain');
  document.querySelector('#deliveries').textContent = uncertain.length
    ? `${uncertain.length} Discord delivery attempt(s) need checking. Delivery may have succeeded; automatic retry is paused to avoid duplicates.` : '';
}
async function refresh() {
  if (refreshing) return;
  refreshing = true;
  try {
    const state = await request('/api/state');
    document.querySelector('#connection').textContent = '● Service connected';
    document.querySelector('#discord-status').textContent = state.discordConfigured ? 'Discord configured' : 'Discord not configured · web works locally';
    const serialized = JSON.stringify(state);
    if (serialized !== previous) { render(state); previous = serialized; }
  } catch {
    document.querySelector('#connection').textContent = 'Service offline · reconnecting';
  } finally { refreshing = false; }
}
form.addEventListener('input', () => { eventId = crypto.randomUUID(); });
form.addEventListener('submit', async event => {
  event.preventDefault();
  const data = new FormData(form);
  const selected = [...document.querySelector('#files').files];
  if (selected.length > 4 || selected.some(file => file.size > 8 * 1024 * 1024)) return showError('Choose up to four files, each no larger than 8 MiB.');
  if (!String(data.get('text')).trim() && !selected.length) return showError('Write a note or attach a file first.');
  data.delete('files');
  for (const file of selected) data.append('files', file);
  data.set('eventId', eventId);
  const controls = [...form.querySelectorAll('button, input, textarea')];
  for (const control of controls) control.disabled = true;
  try {
    await request('/api/messages', { method: 'POST', body: data });
    form.reset(); eventId = crypto.randomUUID(); showError(''); await refresh();
  } catch (error) { showError(`${error.message} You can retry this same message.`); }
  finally { for (const control of controls) control.disabled = false; document.querySelector('#message').focus(); }
});
await refresh();
setInterval(refresh, 1000);
