import './ui.css';
import type { BossGuard } from '../../../shared/boss';
import { fmtCost, fmtTokens } from '../../../shared/protocol';
import { byUrgency } from '../../nextup';
import { store } from '../../state';
import { closeAllModals, h, openModal, STATUS_LABEL, toast } from '../../ui/dom';
import { confirmDialog } from '../../ui/prompt';
import { analytics, dispatchTargets, eligible, MAX_PROMPT, planDispatch } from './logic';
import { downloadReport, floorReport } from './report';

export interface BossDeps {
  send(id: string, prompt: string, guard: BossGuard): void;
  terminal(id: string): void;
  sendHome(id: string): void;
  game(): void;
  chime(): void;
}

export function openBoss(deps: BossDeps) {
  const floor = store.floor;
  const name = store.project?.name ?? 'Office';
  const summary = h('div.boss-summary');
  const list = h('ul.boss-workers', { 'aria-label': 'Workers' });
  const input = h('textarea', { maxlength: MAX_PROMPT, rows: 3, 'aria-label': 'Prompt', placeholder: 'Instructions for regular agents on this floor…' });
  const hint = h('p.boss-hint');
  const broadcast = h('button.btn.primary', { type: 'button' }, 'Review broadcast');
  const assign = h('button.btn', { type: 'button' }, 'Review auto-assign');
  const exportBtn = h('button.btn', { type: 'button', onclick: () => downloadReport(floorReport(name, store.workers.values())) }, 'Export floor report');
  const game = h('button.btn', { type: 'button', onclick: () => { modal.close(); deps.game(); } }, 'Play Minesweeper');
  const el = h('div.modal.boss-center', { role: 'dialog', 'aria-label': 'Boss Control Center' },
    h('header', {}, h('h2', {}, '👔 Boss Control Center')),
    h('p.boss-scope', {}, `Current floor: ${name}. Uses the office’s existing shared controls.`), summary,
    h('div.boss-tools', {}, game, exportBtn), list,
    h('div.boss-composer', {}, h('label', {}, 'Agent instructions', input), hint, h('div.boss-tools', {}, broadcast, assign)));

  function review(auto: boolean) {
    if (store.floor !== floor) return;
    const plan = planDispatch(floor, input.value, store.workers.values(), auto);
    if (!plan) return toast('Enter a prompt and choose an available regular agent (up to 50 per broadcast)', 'warn');
    const busy = plan.targets.filter((w) => w.status === 'working').length;
    confirmDialog(auto ? 'Assign this prompt?' : `Broadcast to ${plan.targets.length} agents?`,
      `${plan.targets.map((w) => w.name).join(', ')}\n\n${plan.prompt}\n\n${busy ? `${busy} busy session(s) may queue this prompt. ` : ''}Replies are in each terminal. Delivery is not confirmed here.`,
      'Send prompt', () => {
        if (!el.isConnected) return;
        const targets = dispatchTargets(plan, store.floor, store.workers);
        for (const w of targets) deps.send(w.id, plan.prompt, { floor: plan.floor, createdAt: w.createdAt, status: w.status });
        if (targets.length) {
          deps.chime();
          if (input.value.trim() === plan.prompt) input.value = '';
        }
        toast(`${targets.length} prompt request(s) sent; ${plan.targets.length - targets.length} changed/unavailable session(s) skipped`);
        refresh();
      });
  }
  broadcast.addEventListener('click', () => review(false));
  assign.addEventListener('click', () => review(true));
  input.addEventListener('input', updateComposer);

  function updateComposer() {
    const workers = [...store.workers.values()];
    const count = workers.filter(eligible).length;
    hint.textContent = `${count} eligible agents. Shells, helpers, board/meeting agents, approvals and unavailable sessions are excluded. Busy agents may queue prompts.`;
    broadcast.disabled = !planDispatch(floor, input.value, workers, false);
    assign.disabled = !planDispatch(floor, input.value, workers, true);
  }

  function refresh() {
    if (store.floor !== floor) { modal.close(); return; }
    const a = analytics(store.workers.values());
    summary.textContent = `${a.total} workers · ${a.working} working · ${a.needs} need you · ${a.done} done · ${fmtTokens(a.tokens)} tokens · ${fmtCost(a.cost)} reported`;
    list.replaceChildren(...byUrgency(store.workers.values()).map((w) => {
      const color = /^#[0-9a-fA-F]{6}$/.test(w.color) ? w.color : '#888888';
      const terminal = () => { closeAllModals(); deps.terminal(w.id); };
      return h('li.boss-worker', {}, h('span.boss-dot', { style: `background:${color}` }),
        h('div.boss-info', {}, h('strong', {}, w.name), h('small', {}, w.helper ? `Helping ${w.helper.hostName}` : w.task?.name ?? w.activity ?? w.title ?? '—')),
        h('span.boss-status', { 'data-status': w.status }, STATUS_LABEL[w.status] ?? w.status),
        h('button.btn', { type: 'button', 'aria-label': `Open ${w.name} terminal`, onclick: terminal }, 'Terminal'),
        ...(w.helperReport ? [h('button.btn', { type: 'button', onclick: terminal }, 'Helper report')] : []),
        h('button.btn.danger', { type: 'button', 'aria-label': `Send ${w.name} home`, onclick: () => { if (!store.workers.has(w.id)) return; closeAllModals(); deps.sendHome(w.id); } }, 'Send home'));
    }));
    if (!list.children.length) list.append(h('li', {}, 'No workers on this floor.'));
    updateComposer();
  }
  let offWorkers = () => {};
  let offFloor = () => {};
  const modal = openModal(el, { doing: '👔 checking floor workers', onClose: () => { offWorkers(); offFloor(); } });
  offWorkers = store.on('workers', refresh);
  offFloor = store.on('floor', refresh);
  refresh();
}
