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
    h('footer', {}, 'Completed = reply acknowledged, or helper report handled through inbox/terminal. This does not confirm a fix or integration.'));
  const open = new Set<string>();
  const render = () => {
    const messages = store.communications.messages;
    renderCommunicationList(body, messages, (id) => { modal.close(); openTerminal(id); }, { unresolved: filter.value === 'open', open, error: store.communications.error });
  };
  const unsubs = [store.on('communications', render), store.on('workers', render)];
  const modal = openModal(el, { doing: 'reading worker communications', reading: true, onClose: () => unsubs.forEach((off) => off()) });
  filter.addEventListener('change', render);
  render();
}

export function renderCommunicationList(body: HTMLElement, messages: WorkerMessage[], openTerminal: (id: string) => void, options: { unresolved?: boolean; open?: Set<string>; error?: string } = {}) {
  const open = options.open ?? new Set<string>();
  const error = options.error;
  const roots = messages.filter((m) => m.kind === 'request' && (!options.unresolved || !['completed', 'expired'].includes(m.status))).reverse();
  const record = (m: WorkerMessage) => h('div.communication-record', {},
    h('p.communication-meta', {}, `${m.from.name} → ${m.to.name}${m.helperReport ? ' · helper report' : ''} · ${m.status}${m.meeting ? ` · round ${m.meeting.round}` : ''} · ${timeAgo(m.at)}`),
    h('pre', {}, m.text), contextLabel(m.context) ? h('p.communication-context', {}, contextLabel(m.context)) : null,
    m.helperReport?.handledVia ? h('p.communication-meta', {}, `Handled through ${m.helperReport.handledVia} · fixing not confirmed`) : null,
    h('code.communication-id', {}, m.id),
    h('p.communication-meta', {}, `Expires ${new Date(m.expiresAt).toLocaleString()}${m.deliveredAt ? ' · inbox read' : ''}${m.acknowledgedAt ? ' · acknowledged' : ''}`));
  body.replaceChildren(...(roots.length ? roots.map((m) => {
    const details = h('details.communication-thread', { open: open.has(m.id) },
      h('summary', {}, h('span.communication-status', { 'data-status': m.status }, m.status), ` ${m.from.name} → ${m.to.name}: ${m.text.split('\n')[0].slice(0, 100)}`),
      record(m), ...messages.filter((r) => r.replyTo === m.id).map(record),
      h('div.communication-actions', {}, ...[m.from, m.to].filter((w) => store.workers.has(w.id)).map((w) => h('button.btn', { type: 'button', onclick: () => { openTerminal(w.id); } }, `Open ${w.name}'s terminal`)))) as HTMLDetailsElement;
    details.addEventListener('toggle', () => { if (details.open) open.add(m.id); else open.delete(m.id); });
    return details;
  }) : [h('p', {}, error ?? 'No requests yet. Workers can use office-workers request and check office-workers inbox between tasks.')]));
}
