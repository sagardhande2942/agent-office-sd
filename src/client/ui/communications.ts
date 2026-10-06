import { contextLabel, type WorkerMessage } from '../../shared/communications';
import { store } from '../state';
import { h, openModal, timeAgo } from './dom';
import './communications.css';

/** Observation does not acknowledge messages on a worker's behalf. */
export function openCommunications(openTerminal: (workerId: string) => void) {
  const filter = h('select', { 'aria-label': 'Filter communications' }, h('option', { value: 'all' }, 'All requests'), h('option', { value: 'open' }, 'Unresolved requests')) as HTMLSelectElement;
  const body = h('div.body.communication-list');
  const el = h('div.modal.communication-modal', { role: 'dialog', 'aria-label': 'Worker communications', style: 'width:min(850px,100%)' },
    h('header', {}, h('h2', {}, '📬 Worker communications'), filter), body,
    h('footer', {}, 'Delivered = read from inbox. Completed = requester acknowledged a reply, not proof of integration.'));
  const open = new Set<string>();
  const render = () => {
    const messages = store.communications.messages;
    const roots = messages.filter((m) => m.kind === 'request' && (filter.value !== 'open' || !['completed', 'expired'].includes(m.status))).reverse();
    const record = (m: WorkerMessage) => h('div.communication-record', {},
      h('p.communication-meta', {}, `${m.from.name} → ${m.to.name} · ${m.status} · ${timeAgo(m.at)}`),
      h('pre', {}, m.text), contextLabel(m.context) ? h('p.communication-context', {}, contextLabel(m.context)) : null,
      h('code.communication-id', {}, m.id),
      h('p.communication-meta', {}, `Expires ${new Date(m.expiresAt).toLocaleString()}${m.deliveredAt ? ' · inbox read' : ''}${m.acknowledgedAt ? ' · acknowledged' : ''}`));
    body.replaceChildren(...(roots.length ? roots.map((m) => {
      const details = h('details.communication-thread', { open: open.has(m.id) },
        h('summary', {}, h('span.communication-status', { 'data-status': m.status }, m.status), ` ${m.from.name} → ${m.to.name}: ${m.text.split('\n')[0].slice(0, 100)}`),
        record(m), ...messages.filter((r) => r.replyTo === m.id).map(record),
        h('div.communication-actions', {}, ...[m.from, m.to].filter((w) => store.workers.has(w.id)).map((w) => h('button.btn', { type: 'button', onclick: () => { modal.close(); openTerminal(w.id); } }, `Open ${w.name}'s terminal`)))) as HTMLDetailsElement;
      details.addEventListener('toggle', () => { if (details.open) open.add(m.id); else open.delete(m.id); });
      return details;
    }) : [h('p', {}, store.communications.error ?? 'No requests yet. Workers can use office-workers request and check office-workers inbox between tasks.')]));
  };
  const unsubs = [store.on('communications', render), store.on('workers', render)];
  const modal = openModal(el, { doing: 'reading worker communications', reading: true, onClose: () => unsubs.forEach((off) => off()) });
  filter.addEventListener('change', render);
  render();
}
