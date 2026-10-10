import './ui.css';
import { floorJoinCommand } from '../../../shared/floor-join';
import { store } from '../../state';
import { h, openModal } from '../../ui/dom';

interface Machine { id: string; name: string; connected: boolean; floors: { name: string; online: boolean }[] }

export function openFloorJoin() {
  let disposed = false;
  let expiresAt = 0;
  const office = h('input', { type: 'url', 'aria-label': 'Office URL', placeholder: 'https://your-office.ngrok.app' });
  office.value = location.origin;
  if (location.port === '5173' && ['localhost', '127.0.0.1'].includes(location.hostname)) office.value = `${location.protocol}//${location.hostname}:4600`;
  const code = h('input', { 'aria-label': 'Pairing code', placeholder: 'Paste the host’s pairing code', autocomplete: 'off' });
  const checkout = h('input', { 'aria-label': 'Your project folder', placeholder: 'C:\\projects\\my-app or /home/me/my-app' });
  const repo = h('input', { 'aria-label': 'Repository (optional)', placeholder: 'OWNER/REPO — detected from origin when omitted' });
  const name = h('input', { 'aria-label': 'Machine name (optional)', placeholder: 'My laptop' });
  const shell = h('select', { 'aria-label': 'Terminal shell' }, h('option', { value: 'powershell' }, 'PowerShell'), h('option', { value: 'bash' }, 'Bash / WSL / macOS'));
  shell.value = /Win/i.test(navigator.platform) ? 'powershell' : 'bash';
  const error = h('p.floor-join-error', { role: 'alert' });
  const expiry = h('p.setting-note');
  const command = h('textarea', { readonly: true, rows: 4, 'aria-label': 'Join command', spellcheck: 'false' });
  const copy = h('button.btn.primary', { type: 'button' }, 'Copy join command');
  const list = h('div.floor-join-machines', { 'aria-live': 'polite' });
  const create = h('button.btn', { type: 'button' }, 'Generate pairing code');

  const refreshCommand = () => {
    let validUrl = false;
    try { const url = new URL(office.value); validUrl = ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && !url.username && !url.password && url.pathname === '/' && !url.search && !url.hash; } catch { /* incomplete URL */ }
    const expired = expiresAt > 0 && Date.now() >= expiresAt;
    const ready = validUrl && /^[0-9A-Z]{4}-[0-9A-Z]{4}$/i.test(code.value.trim()) && !!checkout.value.trim() && !expired;
    copy.disabled = !ready;
    command.value = ready ? floorJoinCommand({ office: office.value.trim(), code: code.value.trim().toUpperCase(), checkout: checkout.value.trim(), repo: repo.value, name: name.value }, shell.value as 'powershell' | 'bash') : '';
    expiry.textContent = expiresAt ? expired ? 'Code expired. Generate a new one.' : `Single use. Expires at ${new Date(expiresAt).toLocaleTimeString()}.` : 'Get a code from the office host, or generate one here as an admin.';
  };
  for (const input of [office, code, checkout, repo, name, shell]) input.addEventListener('input', () => { if (input === code) expiresAt = 0; refreshCommand(); });
  create.disabled = !store.me.admin;
  create.addEventListener('click', async () => {
    create.disabled = true;
    error.textContent = '';
    try {
      const response = await fetch('/api/floor-join/pair', { method: 'POST' });
      const result = await response.json();
      if (!response.ok) throw Error(result.error || 'Could not pair a machine');
      if (disposed) return;
      code.value = result.code;
      expiresAt = result.expiresAt;
      refreshCommand();
    } catch (err) { if (!disposed) error.textContent = (err as Error).message; }
    finally { if (!disposed) create.disabled = !store.me.admin; }
  });
  copy.addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(command.value); copy.textContent = 'Copied'; }
    catch { command.focus(); command.select(); error.textContent = 'Select and copy the command above.'; }
  });
  const status = async () => {
    refreshCommand();
    if (!store.me.admin) return;
    try {
      const response = await fetch('/api/floor-join/status');
      if (!response.ok) throw Error('Could not refresh connection status');
      const result = await response.json() as { machines: Machine[] };
      if (disposed) return;
      list.replaceChildren(...result.machines.map(m => h('div.floor-join-machine', {},
        h('strong', {}, m.name), h('span', { class: m.connected ? 'online' : '' }, m.connected ? 'Connected' : 'Offline'),
        h('p.setting-note', {}, m.floors.length ? m.floors.map(f => `${f.name} · ${f.online ? 'ready' : 'offline'}`).join(', ') : 'Waiting for a project'),
      )));
      if (!result.machines.length) list.textContent = 'No machines connected yet.';
    } catch (err) { if (!disposed) list.textContent = (err as Error).message; }
  };
  const field = (label: string, input: HTMLElement) => h('label.floor-join-field', {}, h('span', {}, label), input);
  const content = h('section.modal.floor-join', { role: 'dialog', 'aria-label': 'Connect your floor', 'aria-modal': 'true' },
    h('header', {}, h('h2', {}, 'Connect your floor')),
    h('div.body', {},
    h('p', {}, 'Host: generate a code and share it with your teammate. Joiner: enter your project folder below, then run the command on your computer.'),
    field('Office URL — use the public ngrok URL for remote teammates', office),
    h('div.floor-join-pair', {}, field('Pairing code', code), create), expiry,
    field('Your project folder — on the joiner’s computer', checkout),
    h('details', {}, h('summary', {}, 'Optional settings'), field('Repository (optional)', repo), field('Machine name (optional)', name), field('Terminal shell', shell)),
    h('p.setting-note', {}, 'Run from your agent-office folder after installing and building it. The project stays on your computer. Everyone in the office can control its terminals; connect only to an office you trust.'),
    command, copy, error,
    h('p.setting-note', {}, 'Keep the command running. Your floor appears in the elevator automatically. Next time, run npm start -- floor-host from the same agent-office folder.'),
    store.me.admin && h('h3', {}, 'Paired machines'), store.me.admin && list,
    ),
  );
  const timer = window.setInterval(() => void status(), 3000);
  openModal(content, { doing: 'connecting a floor', onClose: () => { disposed = true; clearInterval(timer); } });
  refreshCommand();
  void status();
}
