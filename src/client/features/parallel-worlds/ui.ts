import './ui.css';
import { WORLD_APPROACHES, type WorldView, type WorldsResponse, type WorldsView } from '../../../shared/parallel-worlds';
import type { WorldsClientMsg } from '../../../shared/protocol/parallel-worlds';
import { store } from '../../state';
import { h, openModal, STATUS_LABEL, toast, type Modal } from '../../ui/dom';
import { agentFields, officeChoice } from '../../ui/provider';
import { autoTunnel, openServices, serviceUrl } from '../../ui/services';

export interface WorldsUI {
  state(): WorldsResponse;
  refresh(): Promise<void>;
  send(message: WorldsClientMsg): void;
  terminal(id: string): void;
}
export function openWorlds(ui: WorldsUI, picked?: number): Modal {
  const floor = store.floor;
  const body = h('div.body.worlds-body');
  const status = h('p.worlds-status', { role: 'status' }, 'Loading experiments…');
  const content = h('section.modal.worlds-modal', { role: 'dialog', 'aria-label': 'Parallel worlds' },
    h('header', {}, h('h2', {}, '🌀 Parallel worlds')), body);
  let active = true;
  let signature = '';
  let requested = false;
  let room: Modal | undefined;
  let requestTimer: ReturnType<typeof setTimeout> | undefined;
  const modal = openModal(content, { doing: 'exploring parallel worlds', onClose: () => {
    active = false; clearInterval(timer); clearTimeout(requestTimer); room?.close();
  } });
  const form = experimentForm();
  body.append(status, form);
  const results = h('div.worlds-results'); body.append(results);
  const send = (experiment: string, action: 'select' | 'archive' | 'feedback' | 'pr', world?: string, text?: string) => {
    if (!floor || store.floor !== floor) return toast('The floor changed; reopen Parallel worlds', 'warn');
    ui.send({ t: 'worlds.control', floor, experiment, action, world, text });
  };
  function experimentForm() {
    const task = h('textarea', { rows: 3, maxlength: 12000, required: true, 'aria-label': 'Shared task', placeholder: 'Build a dashboard for managing my agents…' });
    const fields = agentFields(store.project, 'worlds-provider', officeChoice(store.project));
    const approaches = WORLD_APPROACHES.map((a, i) => {
      const name = h('input', { value: a.name, maxlength: 40, required: true, 'aria-label': `World ${i + 1} name` });
      const brief = h('textarea', { rows: 3, maxlength: 2000, required: true, 'aria-label': `World ${i + 1} approach` }, a.brief);
      return { name, brief, el: h('label.worlds-approach', { style: `--world-color:${a.color}` }, name, brief) };
    });
    const launch = h('button.btn.primary', { type: 'submit' }, 'Split into three worlds');
    const el = h('form.worlds-create', {},
      h('h3', {}, 'One task. Three possibilities.'),
      h('p.note', {}, 'Three agents start from the same commit in separate branches. Try their previews, give feedback and choose a winner.'),
      h('label', {}, 'Shared task', task),
      h('div.worlds-grid', {}, ...approaches.map(a => a.el)), fields.element,
      h('p.note', {}, 'Requires three free desks and worker capacity. Each worker uses the selected agent/model and the office’s existing budget controls.'), launch);
    el.addEventListener('submit', event => {
      event.preventDefault();
      if (!floor || store.floor !== floor || !uiConnected()) return;
      requested = true; launch.disabled = true; status.textContent = 'Fetching the base and launching three workers…';
      ui.send({ t: 'worlds.start', floor, request: { task: task.value, approaches: approaches.map(a => ({ name: a.name.value, brief: a.brief.value })), agent: { provider: fields.value(), model: fields.model(), effort: fields.effort() } } });
      requestTimer = setTimeout(() => { requested = false; launch.disabled = false; status.textContent = 'Check office notifications if the experiment has not appeared. You can retry.'; }, 25000);
    });
    function uiConnected() { return active && !!store.project; }
    return el;
  }
  function render() {
    if (!active) return;
    if (store.floor !== floor) { modal.close(); return; }
    const state = ui.state();
    const current = [...state.experiments].reverse().find(e => !e.archived);
    form.hidden = !!current;
    if (current && requested) {
      requested = false; clearTimeout(requestTimer);
      (form.querySelector('button[type="submit"]') as HTMLButtonElement).disabled = false;
    }
    status.textContent = state.error ?? (current ? `Shared baseline ${current.base.slice(0, 10)} · ${current.from}` : requested ? 'Fetching the base and launching three workers…' : 'Create an experiment to open your portals.');
    const next = JSON.stringify(state);
    if (next === signature) return;
    signature = next;
    results.replaceChildren();
    if (current) {
      results.append(h('div.worlds-experiment-head', {}, h('div', {}, h('h3', {}, current.task), h('p.note', {}, `Created by ${current.createdBy} · All variants use isolated worktrees`)),
        h('button.btn', { onclick: () => send(current.id, 'archive'), title: 'Keep workers and branches; free the experiment slot' }, 'Archive experiment')));
      const cards = h('div.worlds-grid');
      current.worlds.forEach((world, index) => {
        const worker = world.worker;
        const ready = !!worker && !worker.lost && ['done', 'idle'].includes(worker.status);
        const selected = current.winner === world.id;
        const card = h('article.worlds-card', { style: `--world-color:${WORLD_APPROACHES[index].color}`, class: selected ? 'selected' : '' },
          h('div.worlds-door', {}, h('span', {}, `0${index + 1}`), h('strong', {}, world.name)),
          h('span.worlds-badge', {}, selected ? '★ Selected universe' : world.error ? 'Launch failed' : worker ? STATUS_LABEL[worker.status] ?? worker.status : 'Worker unavailable'),
          h('p', {}, world.brief),
          h('p.note', {}, world.error ?? worker?.activity ?? 'Open this world to inspect its result.'),
          h('code.worlds-branch', {}, worker?.worktree?.branch ?? world.branch ?? 'No branch'),
          h('div.worlds-actions', {},
            h('button.btn.primary', { onclick: () => { room = openRoom(ui, current, world, index, send); } }, 'Enter world'),
            h('button.btn', { disabled: !ready, onclick: () => send(current.id, 'select', world.id) }, selected ? 'Selected ✓' : 'Select winner'),
            selected && h('button.btn', { disabled: !ready || !!worker?.pr, onclick: () => send(current.id, 'pr', world.id) }, 'Open PR')),
          worker?.pr && h('a.btn', { href: worker.pr.url, target: '_blank', rel: 'noopener' }, `PR #${worker.pr.number} ↗`));
        cards.append(card);
      });
      results.append(cards, h('button.btn', { onclick: () => { room = openComparison(current); } }, 'Compare previews side by side'),
        h('p.note', {}, 'Selecting records your choice. Open PR pushes the selected branch for review. Other worlds keep their workers and branches.'));
      if (picked !== undefined) {
        const index = picked; picked = undefined;
        const world = current.worlds[index];
        if (world) room = openRoom(ui, current, world, index, send);
      }
    }
    const past = state.experiments.filter(e => e.archived).reverse();
    if (past.length) results.append(h('details.worlds-history', {}, h('summary', {}, `Archived experiments (${past.length})`), ...past.map(e => h('div', {},
      h('strong', {}, e.task), h('p.note', {}, `${e.base.slice(0, 10)} · ${e.winner ? `Selected ${e.worlds.find(w => w.id === e.winner)?.name}` : 'No winner selected'}`),
      ...e.worlds.map((w, i) => h('button.btn', { onclick: () => { room = openRoom(ui, e, w, i, send); } }, w.name))))));
  }
  const tick = async () => { try { await ui.refresh(); render(); } catch (err) { if (active) status.textContent = (err as Error).message; } };
  const timer = setInterval(() => void tick(), 2500);
  void tick();
  return modal;
}

type Send = (experiment: string, action: 'select' | 'archive' | 'feedback' | 'pr', world?: string, text?: string) => void;
function openRoom(ui: WorldsUI, experiment: WorldsView, world: WorldView, index: number, send: Send): Modal {
  const screen = previewScreen(world);
  const feedback = h('textarea', { rows: 3, maxlength: 12000, required: true, 'aria-label': `Feedback for ${world.name}`, placeholder: 'Keep the map, but make blocked workers easier to spot…' });
  const form = h('form.worlds-feedback', {}, feedback, h('button.btn.primary', { type: 'submit', disabled: experiment.archived || !world.workerId || !world.worker }, 'Send feedback'));
  form.addEventListener('submit', event => { event.preventDefault(); send(experiment.id, 'feedback', world.id, feedback.value); feedback.value = ''; });
  const worker = world.worker;
  const panel = h('section.modal.worlds-room', { role: 'dialog', 'aria-label': `${world.name} universe`, style: `--world-color:${WORLD_APPROACHES[index].color}` },
    h('header', {}, h('h2', {}, `🌀 ${world.name} universe`)),
    h('div.body', {}, h('p', {}, world.brief), screen,
      h('div.worlds-room-bottom', {}, h('div', {}, h('h3', {}, worker?.name ?? 'Worker unavailable'),
        h('p.note', {}, worker ? `Status when opened: ${STATUS_LABEL[worker.status] ?? worker.status}` : world.error ?? 'The worker was sent home; its saved branch remains in history.'),
        h('code.worlds-branch', {}, worker?.worktree?.branch ?? world.branch ?? ''),
        worker?.completion && h('details', {}, h('summary', {}, `Worker-reported checks: ${worker.completion.status}`),
          h('p', {}, worker.completion.summary),
          ...worker.completion.checks.map(check => h('p.note', {}, `${check.status.toUpperCase()} · ${check.name}: ${check.evidence}`))),
        h('button.btn', { disabled: !world.workerId || !worker, onclick: () => ui.terminal(world.workerId!) }, 'Open agent terminal')),
      h('div', {}, h('h3', {}, 'Direct this universe'), form))));
  return openModal(panel, { doing: `exploring ${world.name} universe` });
}

function previewScreen(world: WorldView): HTMLElement {
  const services = store.services.items.filter(s => s.workerId === world.workerId);
  const display = h('div.worlds-screen');
  if (!services.length) {
    display.append(h('div.worlds-empty-screen', {}, h('span', {}, '◌'), h('h3', {}, 'Waiting for a working preview'),
      h('p', {}, 'The agent needs to start a web server in its worktree. Reopen this world once it appears in Services. Non-web projects can be reviewed in the agent terminal.')));
    return display;
  }
  const select = h('select', { 'aria-label': `Preview server for ${world.name}` }, ...services.map(s => h('option', { value: s.port }, `${s.title || s.command} · :${s.port}`)));
  const frame = h('iframe', { title: `${world.name} preview`, sandbox: 'allow-scripts allow-forms allow-same-origin', referrerpolicy: 'no-referrer', allow: 'camera \'none\'; microphone \'none\'; geolocation \'none\'' });
  const link = h('a.btn', { target: '_blank', rel: 'noopener' }, 'Open full screen ↗');
  const load = () => {
    const url = serviceUrl(Number(select.value));
    // Only discovered worker services, on a different origin from the office, enter the iframe.
    if (new URL(url).origin === location.origin) return;
    frame.src = url; link.href = url;
  };
  select.addEventListener('change', load); load();
  display.append(h('div.worlds-preview-toolbar', {}, select, link, h('button.btn', { onclick: load }, 'Reload'), h('button.btn', { onclick: openServices }, 'Services / tunnels')), frame,
    h('p.note', {}, `If the office runs remotely, start ${autoTunnel()} on your computer. If embedding is blocked, use Open full screen.`));
  return display;
}
function openComparison(experiment: WorldsView): Modal {
  return openModal(h('section.modal.worlds-compare', { role: 'dialog', 'aria-label': 'Compare universes' },
    h('header', {}, h('h2', {}, 'Compare universes')),
    h('div.body.worlds-grid', {}, ...experiment.worlds.map((w, i) => h('article', { style: `--world-color:${WORLD_APPROACHES[i].color}` }, h('h3', {}, w.name), previewScreen(w))))), { doing: 'comparing universes' });
}
