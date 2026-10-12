import { h, openModal, toast, type Modal } from '../../ui/dom';
import { store } from '../../state';
import type { Net } from '../../net';
import type { ResearchAction, ResearchBrief, ResearchExperiment, ResearchView } from '../../../shared/trading-research';
import { researchBrief } from '../../../shared/trading-research';
import { canRest, isAsleep } from '../../../shared/status';
import './ui.css';

export function openResearch(net: Net, listen: (fn: (view: ResearchView) => void) => () => void): Modal {
  const floor = store.floor, admin = store.me.admin;
  const root = h('section.modal.research-panel', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Trading Research' });
  const status = h('p.research-status', { role: 'status' }, 'Connecting…'), runtime = h('div.research-runtime');
  const url = h('input', { 'aria-label': 'Coordinator URL', value: 'http://127.0.0.1:4601', required: true });
  const token = h('input', { type: 'password', 'aria-label': 'Coordinator token', autocomplete: 'off', placeholder: 'Paste token from the coordinator token file' });
  const enabled = h('input', { type: 'checkbox', 'aria-label': 'Enable Trading Research' });
  const connection = h('form.research-connection', {}, h('h3', {}, 'Floor connection'),
    h('label', {}, enabled, ' Enable Trading Research on this floor'), field('Coordinator URL', url), field('Coordinator token', token),
    h('p', {}, 'The coordinator runs on this floor host. Its token stays on the server. Leave token blank to keep the saved value.'),
    h('button.btn', { type: 'submit', disabled: !admin }, 'Save connection'));
  const objective = h('textarea', { 'aria-label': 'Research objective', required: true, maxlength: 4000, rows: 3, placeholder: 'Describe the behaviour you want investigated and what would disprove it.' });
  const constraints = h('textarea', { 'aria-label': 'Research constraints', maxlength: 4000, rows: 2 });
  const symbols = h('input', { 'aria-label': 'Research symbols', value: 'EURUSD', required: true });
  const timeframe = h('select', { 'aria-label': 'Research timeframe' }, ...['M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1'].map(v => h('option', { value: v }, v)));
  const start = h('input', { type: 'date', 'aria-label': 'Development start', required: true });
  const end = h('input', { type: 'date', 'aria-label': 'Development end', required: true });
  const dataset = h('input', { 'aria-label': 'Dataset version', required: true, maxlength: 240, placeholder: 'Dataset version or fingerprint' });
  const experiments = h('input', { type: 'number', 'aria-label': 'Experiment limit', min: 1, max: 100, value: 5, required: true });
  const workers = h('input', { type: 'number', 'aria-label': 'Worker limit', min: 1, max: 8, value: 2, required: true });
  const timeout = h('input', { type: 'number', 'aria-label': 'Execution timeout minutes', min: 1, max: 120, value: 30, required: true });
  const walk = h('input', { type: 'checkbox', 'aria-label': 'Run walk-forward' });
  const createButton = h('button.btn', { type: 'submit', disabled: true }, 'Create campaign');
  const campaignForm = h('form.research-campaign-form', {}, h('h3', {}, 'New campaign'), field('Objective', objective), field('Constraints', constraints),
    h('div.research-grid', {}, field('Symbols, separated by commas', symbols), field('Timeframe', timeframe), field('Development start', start), field('Development end', end), field('Dataset version', dataset),
      field('Maximum experiments', experiments), field('Maximum assigned workers', workers), field('Timeout per execution, minutes', timeout)),
    h('label', {}, walk, ' Run development walk-forward after screening'),
    h('p', {}, 'Office workers use their configured agent and model. Paid AI APIs are disabled. Results remain research; final holdout and trading are separate.'), createButton);
  root.append(h('header', {}, h('div', {}, h('h2', {}, 'Trading Research'), h('p', {}, 'Campaigns, coding workers and measured experiments for this floor'))),
    h('div.research-scroll', {}, status, connection, campaignForm, runtime));
  let initialized = false, disposed = false, latest: ResearchView | undefined, requestId = crypto.randomUUID();
  const send = (body: ResearchAction) => { if (store.floor === floor) net.send({ t: 'research.action', body }); };
  connection.addEventListener('submit', e => {
    e.preventDefault(); net.send({ t: 'research.configure', enabled: enabled.checked, url: url.value, ...(token.value ? { token: token.value } : {}) });
    token.value = '';
  });
  campaignForm.addEventListener('submit', e => {
    e.preventDefault();
    try {
      const brief: ResearchBrief = researchBrief({ objective: objective.value, constraints: constraints.value, symbols: symbols.value.split(',').map(s => s.trim().toUpperCase()), timeframe: timeframe.value,
        start: start.value.replaceAll('-', ''), end: end.value.replaceAll('-', ''), dataset: dataset.value, maxExperiments: Number(experiments.value), maxWorkers: Number(workers.value), timeoutMinutes: Number(timeout.value), walkForward: walk.checked });
      send({ action: 'create', brief, requestId });
    } catch (error) { toast((error as Error).message, 'warn'); }
  });
  function render(view: ResearchView) {
    latest = view;
    if (!initialized) { initialized = true; enabled.checked = view.enabled; url.value = view.url; }
    status.textContent = !view.enabled ? 'Enable this module to connect a research coordinator.' : view.connected ? 'Connected · worker generation · paid AI disabled' : `Disconnected: ${view.error ?? 'Coordinator unavailable'}. Campaigns and drafts are preserved.`;
    createButton.disabled = !admin || !view.connected;
    if (view.state?.campaigns.length && view.state.campaigns.some(c => c.brief.objective === objective.value.trim())) requestId = crypto.randomUUID();
    runtime.replaceChildren();
    if (!view.state) return;
    for (const c of [...view.state.campaigns].reverse()) {
      const runs = view.state.experiments.filter(e => e.campaign === c.id);
      const card = h('section.research-campaign', {}, h('h3', {}, c.brief.objective), h('p', {}, `${c.paused ? 'Paused' : 'Active'} · ${runs.length}/${c.brief.maxExperiments} experiments · ${c.brief.symbols.join(', ')} / ${c.brief.timeframe}`),
        h('p', {}, `Development: ${c.brief.start}–${c.brief.end} · dataset: ${c.brief.dataset}`),
        h('button.btn', { disabled: !admin, onclick: () => send({ action: 'pause', campaign: c.id, paused: !c.paused }) }, c.paused ? 'Resume campaign' : 'Pause scheduling'));
      const instructions = h('textarea', { 'data-campaign': c.id, 'aria-label': 'Next hypothesis', rows: 2, placeholder: 'A distinct hypothesis or a justified revision' });
      const next = h('form.research-next', {}, instructions, h('button.btn', { type: 'submit', disabled: !admin }, 'Add research task'));
      const nextRequest = crypto.randomUUID();
      next.addEventListener('submit', e => { e.preventDefault(); if (instructions.value.trim()) send({ action: 'add', campaign: c.id, instructions: instructions.value, requestId: nextRequest }); });
      // Preserve drafts during polling; replace the board only when state changes.
      card.append(next);
      for (const a of view.state.assignments.filter(a => a.campaign === c.id)) {
        const row = h('div.research-assignment', {}, h('strong', {}, `${a.role} · ${a.status}`), h('p', {}, a.instructions), a.error ? h('p', {}, a.error) : null);
        if (a.status === 'queued') {
          const select = h('select', { 'aria-label': `Worker for ${a.id}` }, h('option', { value: '' }, 'Choose a ready coding worker'));
          for (const w of store.workers.values()) if (w.kind === 'agent' && !w.helper && !w.meeting && !w.planReview && !w.resting && !w.lost && !w.deskId.startsWith('station-') && (canRest(w) || isAsleep(w.status))) select.append(h('option', { value: w.id }, w.name));
          const dispatch = h('button.btn', { disabled: !admin || c.paused, onclick: () => { if (select.value) net.send({ t: 'research.dispatch', assignment: a.id, worker: select.value }); else toast('Choose a worker first'); } }, 'Assign worker');
          row.append(select, dispatch);
          if (a.role === 'researcher') row.append(h('button.btn', { disabled: !admin || c.paused, onclick: () => manual(a.id) }, 'Submit manually'));
        } else if (a.status === 'assigned') row.append(h('p', {}, `Worker: ${store.workers.get(a.worker!)?.name ?? a.worker}`),
          h('button.btn', { disabled: !admin, onclick: () => send({ action: 'release', assignment: a.id, lease: '', reason: 'Released by an administrator; previous submissions are now stale.' }) }, 'Release assignment'));
        card.append(row);
      }
      for (const e of runs) card.append(experimentCard(e));
      runtime.append(card);
    }
    if (!view.state.campaigns.length) runtime.append(h('p', {}, 'Create your first campaign, then assign a ready worker or submit a strategy manually.'));
  }
  function experimentCard(e: ResearchExperiment) {
    const phases = Array.isArray(e.metrics?.phases) ? e.metrics.phases as Record<string, unknown>[] : [];
    const row = h('article.research-experiment', {}, h('strong', {}, `${e.hypothesis} · ${e.status}`), h('p', {}, `${e.outcome} · attempt ${e.attempts} · ${e.id}`));
    for (const phase of phases) row.append(h('p', {}, `${phase.phase ?? 'evaluation'}: trades ${phase.total_trades ?? '—'} · net PnL ${phase.total_pnl ?? '—'} · drawdown ${phase.max_drawdown ?? '—'}${phase.error ? ` · ${phase.error}` : ''}`));
    if (e.error) row.append(h('p.research-error', {}, e.error));
    if (e.review) row.append(h('p', {}, `Review: ${e.review.decision} — ${e.review.summary}`));
    row.append(h('button.btn', { onclick: () => {
      const details = h('section.modal.research-details', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Experiment evidence' }, h('header', {}, h('h2', {}, 'Experiment evidence')), h('pre', {}, JSON.stringify(e, null, 2)));
      openModal(details, { doing: 'reviewing experiment evidence' });
    } }, 'View evidence'));
    if (['failed', 'interrupted'].includes(e.status) && !e.batch) row.append(h('button.btn', { disabled: !admin, onclick: () => send({ action: 'retry', experiment: e.id }) }, 'Retry stopped execution'));
    if (e.status === 'queued') row.append(h('button.btn', { disabled: !admin, onclick: () => send({ action: 'cancel', experiment: e.id }) }, 'Cancel queued experiment'));
    if (['running', 'blocked'].includes(e.status)) row.append(h('button.btn', { disabled: !admin || e.cancelRequested, onclick: () => send({ action: 'cancel', experiment: e.id }) }, e.cancelRequested ? 'Cancellation requested' : 'Request cancellation'));
    return row;
  }
  function manual(assignment: string) {
    const hypothesis = h('textarea', { 'aria-label': 'Manual hypothesis', required: true, maxlength: 4000 });
    const code = h('textarea', { 'aria-label': 'Strategy Python code', required: true, maxlength: 100000, rows: 10 });
    const config = h('textarea', { 'aria-label': 'Strategy configuration', required: true, maxlength: 50000, rows: 7 });
    const form = h('form', {}, field('Hypothesis', hypothesis), field('Strategy Python code', code), field('Strategy configuration', config), h('button.btn', { type: 'submit' }, 'Submit strategy'));
    const modal = openModal(h('section.modal.research-details', { role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Manual strategy' }, h('header', {}, h('h2', {}, 'Manual strategy')), form), { onClose: () => submitted() });
    const submitted = listen(view => { if (view.state?.assignments.find(a => a.id === assignment)?.status === 'submitted') modal.close(); });
    form.addEventListener('submit', ev => { ev.preventDefault(); send({ action: 'manual', assignment, hypothesis: hypothesis.value, code: code.value, config: config.value }); });
  }
  let signature = '';
  const update = (view: ResearchView) => {
    const next = JSON.stringify([view.enabled, view.connected, view.error, view.state?.revision, [...store.workers.values()].map(w => [w.id, w.name, w.status, w.resting, w.lost])]);
    if (next !== signature) {
      // Hold form drafts while another user changes campaign state.
      const drafts = [...runtime.querySelectorAll<HTMLTextAreaElement>('.research-next textarea')].map(el => [el.dataset.campaign, el.value] as const);
      const choices = new Map([...runtime.querySelectorAll<HTMLSelectElement>('select')].map(el => [el.getAttribute('aria-label'), el.value]));
      signature = next; render(view);
      [...runtime.querySelectorAll<HTMLTextAreaElement>('.research-next textarea')].forEach(el => { el.value = drafts.find(([id]) => id === el.dataset.campaign)?.[1] ?? ''; });
      runtime.querySelectorAll<HTMLSelectElement>('select').forEach(el => { const value = choices.get(el.getAttribute('aria-label')); if (value && [...el.options].some(o => o.value === value)) el.value = value; });
    }
  };
  const off = listen(update);
  const offWorkers = store.on('workers', () => { if (latest) update(latest); });
  const refresh = () => { if (!disposed && store.floor === floor) net.send({ t: 'research.get' }); };
  const timer = setInterval(refresh, 3000); refresh();
  return openModal(root, { doing: 'running trading research', onClose: () => { disposed = true; clearInterval(timer); off(); offWorkers(); latest = undefined; } });
}
function field(label: string, input: HTMLElement) { return h('label.research-field', {}, h('span', {}, label), input); }
