import type { CuratorSettings, CuratorState, CuratorClientMsg } from '../../../shared/lore-curator';
import type { LoreNote } from '../../../shared/protocol/lore';
import { h, openModal, toast, type Modal } from '../../ui/dom';
import { agentFields } from '../../ui/provider';
import { store } from '../../state';
import type { Net } from '../../net';
import './ui.css';
export interface CuratorUI { net: Net; state(): CuratorState | undefined; listen(fn: (state: CuratorState) => void): () => void;
  history(fn: (id: string, revisions: { revision: number; note: LoreNote }[]) => void): () => void }
export function openCurator(ui: CuratorUI): Modal {
  const floor = store.floor;
  const root = h('section.modal.lore-curator');
  const header = h('header', {}, h('div', {}, h('h2', {}, 'Knowledge curator'), h('p', {}, 'Automatic cleanup for this floor’s shared knowledge')));
  const form = h('form.curator-form');
  const status = h('p.curator-status', { role: 'status' }, 'Loading curator settings…');
  const runtime = h('section.curator-runtime');
  const notes = h('section.curator-notes');
  const history = h('section.curator-history');
  root.append(header, h('div.curator-scroll', {}, status, form, runtime, notes, history));
  let initialized = false, latest: CuratorState | undefined, awaitingSave: CuratorSettings | undefined;
  const admin = store.me.admin;
  const send = (message: CuratorClientMsg) => { if (store.floor !== floor) return; ui.net.send(message); };
  const input = (id: string, type: string, value: string) => h('input', { id: `curator-${id}`, type, value }) as HTMLInputElement;
  const field = (label: string, element: HTMLElement) => h('label.curator-field', {}, h('span', {}, label), element);
  const enabled = input('enabled', 'checkbox', ''), after = input('after-completion', 'checkbox', '');
  const schedule = h('select', { id: 'curator-schedule' }, h('option', { value: 'interval' }, 'Every interval'), h('option', { value: 'daily' }, 'Daily at a time')) as HTMLSelectElement;
  const interval = input('interval', 'number', '360'); interval.min = '5'; interval.max = '43200';
  const daily = input('daily', 'time', '02:00'), timezone = input('timezone', 'text', 'UTC');
  const batch = input('batch', 'number', '20'); batch.min = '2'; batch.max = '50';
  const intervalRow = field('Interval (minutes)', interval), dailyRow = field('Daily time', daily);
  const tzRow = field('Timezone (IANA)', timezone);
  const scheduleRows = () => { intervalRow.hidden = schedule.value !== 'interval'; dailyRow.hidden = tzRow.hidden = schedule.value !== 'daily'; };
  schedule.onchange = scheduleRows;
  let agent: ReturnType<typeof agentFields> | undefined;
  function init(state: CuratorState) {
    enabled.checked = state.settings.enabled; after.checked = state.settings.afterCompletion;
    schedule.value = state.settings.schedule; interval.value = String(state.settings.intervalMinutes); daily.value = state.settings.dailyTime;
    timezone.value = state.settings.timezone; batch.value = String(state.settings.maxNotes);
    agent = agentFields({ ...store.project!, agentProviders: [...new Set([...state.providers, state.settings.provider])], defaultProvider: state.settings.provider }, 'curator-agent', { provider: state.settings.provider, model: state.settings.model }, 'Curator agent');
    const save = h('button.btn.primary', { type: 'submit', disabled: !admin || !state.providers.length }, 'Save settings');
    form.append(h('h3', {}, 'Schedule and agent'), h('div.curator-grid', {}, field('Enable automatic curation', enabled), field('After worker completion', after), field('Schedule', schedule), intervalRow, dailyRow, tzRow, field('Maximum notes per run', batch)), agent.element,
      h('p.setting-note', {}, 'Uses the selected agent’s existing login on this floor’s machine. Coding-worker defaults are independent. Runs review bounded repository excerpts without modifying the checkout.'),
      h('p.setting-note', {}, state.providers.length ? 'Supported background adapters: Claude Code and Codex. Other agents remain available for coding workers.' : 'Install Claude Code or Codex and restart this floor host to enable curation.'), save,
      ...(!admin ? [h('p.setting-note', {}, 'Only admins can change settings, run curation or restore notes.')] : []));
    if (!admin) for (const control of form.querySelectorAll<HTMLInputElement | HTMLSelectElement>('input, select')) control.disabled = true;
    form.onsubmit = e => {
      e.preventDefault(); if (!latest || !agent?.valid()) return;
      const choice = agent.choice();
      const settings: CuratorSettings = { enabled: enabled.checked, paused: latest.settings.paused, afterCompletion: after.checked,
        schedule: schedule.value as CuratorSettings['schedule'], intervalMinutes: Number(interval.value), dailyTime: daily.value, timezone: timezone.value.trim(),
        maxNotes: Number(batch.value), provider: choice.provider as CuratorSettings['provider'], ...(choice.model ? { model: choice.model } : {}) };
      awaitingSave = settings; send({ t: 'curator.configure', settings });
    };
    initialized = true; scheduleRows();
  }
  function paint(state: CuratorState) {
    latest = state; if (!initialized) init(state);
    if (awaitingSave && Object.keys(awaitingSave).every(k => state.settings[k as keyof CuratorSettings] === awaitingSave![k as keyof CuratorSettings])) { awaitingSave = undefined; toast('Curator settings updated'); }
    let next = 'Automatic curation disabled';
    if (state.settings.enabled) next = state.settings.paused ? 'Automatic curation paused' : `Next scheduled run: ${state.nextRunAt ? new Date(state.nextRunAt).toLocaleString(undefined, { timeZone: state.settings.timezone }) + ' ' + state.settings.timezone : 'pending'}`;
    status.textContent = `${state.running ? 'Curator running · ' : ''}${next} · ${state.pending} notes queued${state.retryAt ? ` · Retry: ${new Date(state.retryAt).toLocaleString()}` : ''}`;
    const run = h('button.btn.primary', { type: 'button', disabled: !admin || state.running || !state.providers.includes(state.settings.provider), onclick: () => send({ t: 'curator.run' }) }, 'Run now');
    const pause = h('button.btn', { type: 'button', disabled: !admin || !state.settings.enabled, onclick: () => send({ t: 'curator.pause', paused: !state.settings.paused }) }, state.settings.paused ? 'Resume schedule' : 'Pause');
    runtime.replaceChildren(h('div.curator-actions', {}, run, pause), h('h3', {}, 'Recent runs'));
    for (const r of state.runs.slice(0, 5)) runtime.append(h('article.curator-run', {}, h('strong', {}, `${r.status} · ${r.provider}${r.model ? ` / ${r.model}` : ' / default model'}`),
      h('small', {}, `${new Date(r.startedAt).toLocaleString()} · ${r.trigger} · ${r.changed} notes changed · ${r.skipped} concurrent changes skipped`), h('p', {}, r.summary), ...(r.decisions?.length ? [h('details', {}, h('summary', {}, 'View decisions'), ...r.decisions.map(d => h('p', {}, `${d.id}: ${d.before} → ${d.after}. ${d.reason}`)))] : [])));
    if (!state.runs.length) runtime.append(h('p.setting-note', {}, 'No curator runs yet. Save your settings to schedule automatic cleanup, or run once now.'));
    notes.replaceChildren(h('h3', {}, 'Knowledge lifecycle'));
    const filter = h('select', { 'aria-label': 'Knowledge status' }, ...['all', 'active', 'needs-verification', 'superseded', 'archived'].map(s => h('option', { value: s }, s))) as HTMLSelectElement;
    const list = h('div.curator-note-list');
    const draw = () => {
      list.replaceChildren();
      for (const n of state.notes.filter(n => filter.value === 'all' || n.status === filter.value).slice(0, 100)) {
        const inspect = h('button.btn', { type: 'button', onclick: () => send({ t: 'curator.history', id: n.id }) }, 'History');
        const restore = h('button.btn', { type: 'button', disabled: !admin, onclick: () => send({ t: 'curator.restore', id: n.id }) }, 'Restore original');
        list.append(h('article.curator-note', {}, h('strong', {}, n.title), h('span.curator-badge', {}, n.status), h('p', {}, n.reason),
          h('small', {}, `Sources: ${n.sources.join(', ')} · ${n.revisions} revisions`), h('div.curator-actions', {}, inspect, ...(n.status !== 'active' ? [restore] : []))));
      }
    };
    filter.onchange = draw; notes.append(filter, list); draw();
  }
  const offState = ui.listen(paint);
  const offHistory = ui.history((id, revisions) => {
    const title = latest?.notes.find(n => n.id === id)?.title ?? id;
    history.replaceChildren(h('h3', {}, `Original revisions: ${title}`));
    for (const { note, revision } of [...revisions].reverse()) history.append(h('article.curator-note', {}, h('strong', {}, `Revision ${revision + 1} · ${note.author}`),
      h('small', {}, new Date(note.updatedAt).toLocaleString()), h('pre', {}, note.content), h('button.btn', { type: 'button', disabled: !admin, onclick: () => send({ t: 'curator.restore', id, revision }) }, 'Restore this revision')));
    history.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
  const modal = openModal(root, { doing: 'managing knowledge curator', onClose: () => { offState(); offHistory(); } });
  const initial = ui.state(); if (initial) paint(initial);
  send({ t: 'curator.get' });
  return modal;
}
