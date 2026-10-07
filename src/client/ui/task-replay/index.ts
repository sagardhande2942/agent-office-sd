import './style.css';
import type { TeamRun } from '../../../shared/master-workers';
import type { ReplayEvent, ReplayEventType } from '../../../shared/task-replay';
import { store } from '../../state';
import { h, openModal } from '../dom';

export const EVENT_LABELS: Record<ReplayEventType, string> = {
  start: 'Activity started', plan: 'Plan submitted', assignment: 'Task assigned',
  result: 'Worker result', blocker: 'Blocker', retry: 'Retry', review: 'Review decision',
  integration: 'Integration', pause: 'Paused', resume: 'Resumed', stop: 'Stopped', 'final-pr': 'Final PR',
};
export function safePrUrl(value?: string): string | undefined {
  if (!value) return;
  try { const u = new URL(value); if (['https:', 'http:'].includes(u.protocol) && !u.username && !u.password) return u.href; } catch { /* missing or invalid link */ }
}
export function chronological(events: ReplayEvent[]): ReplayEvent[] {
  return [...events].sort((a, b) => a.timestamp - b.timestamp);
}
export function filterEvents(events: ReplayEvent[], participant: string, task: string, type: string) {
  return chronological(events).filter(e => (!participant || e.participantId === participant) && (!task || e.taskId === task) && (!type || e.type === type));
}

/** Reads the existing floor state; never sends activity actions or invokes participants. */
export function openTaskReplay(initial: TeamRun) {
  let participant = '', task = '', type = '';
  const expanded = new Set<string>();
  const body = h('div.body.replay-body');
  const close = h('button.btn.close', { 'aria-label': 'Close', title: 'Close (Esc)' }, '✕');
  const el = h('div.modal.replay-window', { role: 'dialog', 'aria-label': 'Replay task' },
    h('header', {}, h('h2', {}, 'Replay a task'), close), body);
  const run = () => [store.masterWorkers.current, ...store.masterWorkers.past].find(r => r?.id === initial.id) ?? initial;
  const participantLabel = (r: TeamRun, id: string) => {
    const choice = id === r.masterId ? r.master : r.workers.find(w => w.workerId === id)?.choice;
    const name = store.workers.get(id)?.name;
    return `${id === r.masterId ? 'Master' : name ?? 'Worker'} · ${choice?.model ?? id} (${id})`;
  };
  const select = (label: string, value: string, options: [string, string][], set: (v: string) => void) => {
    const input = h('select', { 'aria-label': label }, h('option', { value: '' }, `All ${label.toLowerCase()}s`),
      ...options.map(([id, name]) => h('option', { value: id }, name)));
    input.value = value;
    input.addEventListener('change', () => { set(input.value); render(); body.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)?.focus(); });
    return h('label', {}, label, input);
  };
  const eventCard = (r: TeamRun, e: ReplayEvent) => {
    const d = e.details;
    const time = new Date(e.timestamp);
    const card = h('details.replay-event', { open: expanded.has(e.id), 'data-event-id': e.id },
      h('summary', {}, h('time', { datetime: time.toISOString() }, time.toLocaleString()),
        h('strong', {}, EVENT_LABELS[e.type]), h('span', {}, e.summary)));
    card.addEventListener('toggle', () => { if (card.open) expanded.add(e.id); else expanded.delete(e.id); });
    const details = h('div.replay-details');
    details.append(h('p.muted', {}, `Activity: ${e.activityId} · Event: ${e.id}`));
    if (e.participantId) details.append(h('p', {}, participantLabel(r, e.participantId)));
    if (e.taskId) details.append(h('p', {}, `Task: ${r.tasks.find(t => t.id === e.taskId)?.title ?? e.taskId} (${e.taskId})`));
    const fields: [string, string | undefined][] = [
      ['Instructions', d.instructions], ['Message', d.message], ['Result evidence', d.evidence],
      ['Review reasons', d.reviewReason], ['Reported checks (participant claim)', d.reportedChecks],
      ['Independently verified facts (office)', d.verifiedChecks],
    ];
    for (const [label, value] of fields) details.append(h('section', {}, h('h4', {}, label),
      value ? h('pre', {}, value) : h('p.muted', {}, 'Not recorded for this event.')));
    details.append(h('section', {}, h('h4', {}, 'Commit references'),
      d.commits?.length ? h('pre', {}, d.commits.join('\n')) : h('p.muted', {}, 'Not recorded for this event.')));
    const url = safePrUrl(d.pr);
    details.append(h('section', {}, h('h4', {}, 'PR link'), url
      ? h('a', { href: url, target: '_blank', rel: 'noopener noreferrer' }, url)
      : h('p.muted', {}, d.pr ? 'Recorded PR link is unavailable (invalid URL).' : 'Not recorded for this event.')));
    if (d.missing?.length) details.append(h('p.replay-notice', {}, 'Missing details: ' + d.missing.join('; ')));
    card.append(details);
    return card;
  };
  const render = () => {
    const r = run(), log = r.replay, events = log?.events ?? [];
    const scroll = body.scrollTop;
    const focus = document.activeElement?.getAttribute('aria-label');
    const options = h('div.replay-filters', {},
      select('Participant', participant, [...new Set(events.flatMap(e => e.participantId ? [e.participantId] : []))].map(id => [id, participantLabel(r, id)]), v => participant = v),
      select('Task', task, [...new Set(events.flatMap(e => e.taskId ? [e.taskId] : []))].map(id => [id, `${r.tasks.find(t => t.id === id)?.title ?? id} (${id})`]), v => task = v),
      select('Event type', type, Object.entries(EVENT_LABELS), v => type = v));
    body.replaceChildren(h('h3', {}, r.brief), h('p.muted', {}, `${r.phase} · ${r.id}`),
      h('p', {}, 'Read-only recorded activity. Reported checks are participant claims; office-verified facts do not imply tests were independently run.'), options);
    if (!log || log.historical) body.append(h('p.replay-notice', {}, 'Historical details are missing: event recording was unavailable for part or all of this activity. Earlier events and their timestamps have not been reconstructed.'));
    if (log?.dropped) body.append(h('p.replay-notice', {}, `${log.dropped} older events were removed by bounded retention. Only the latest retained events are available.`));
    const visible = filterEvents(events, participant, task, type);
    body.append(h('p.muted', { 'aria-live': 'polite' }, `${visible.length} of ${events.length} retained events`));
    if (!visible.length) body.append(h('p.empty', {}, events.length ? 'No events match these filters.' : 'No recorded events available.'));
    else body.append(h('div.replay-timeline', {}, ...visible.map(e => eventCard(r, e))));
    body.scrollTop = scroll;
    if (focus && ['Participant', 'Task', 'Event type'].includes(focus)) body.querySelector<HTMLSelectElement>(`select[aria-label="${focus}"]`)?.focus({ preventScroll: true });
  };
  const off = store.on('masterWorkers', render);
  const modal = openModal(el, { doing: 'inspecting task replay', reading: true, onClose: off });
  close.addEventListener('click', () => modal.close());
  render();
  return modal;
}
