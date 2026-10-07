import { visitWorker } from '../shared/worker-terminal';
import type { Game } from './context';
import { DESK_BY_ID, nextFreeSeat } from '../../shared/layout';
import { officeFull } from '../../shared/machine';
import { isAsleep } from '../../shared/status';
import { workerPolicies } from '../shared/worker-actions';
import { repoChoices } from '../shared/hiring';
import { openTerminal } from '../ui/terminal';
import { openChanges } from '../ui/changes';
import { openAsk } from '../ui/ask';
import { openBoard } from '../ui/boards';
import { openQueue } from '../ui/queue';
import { openPlanReview } from '../ui/plan-review';
import { openMeeting } from '../ui/meeting';
import { closeAllModals, toast } from '../ui/dom';
import type { BoardActions } from '../ui/github/prompts';

export function installActions(g: Game) {
  const { net, store } = g;
  const officeIsFull = () => { const full = officeFull(store.machine); if (full) toast('Office full — send a worker home before hiring', 'warn'); return full; };
  const hire: Parameters<typeof workerPolicies>[0]['hire'] = (deskId, prompt, worktree, provider, model, effort, issue, repos) => {
    if (!g.playable() || officeIsFull() || store.workerAtDesk(deskId)) return;
    net.send({ t: 'worker.spawn', deskId, prompt, worktree, provider, model, effort, issue, repos });
  };
  function openWorker(id: string) {
    if (!g.playable()) return;
    visitWorker(id, { lost: policies.fixLostWorktree, resume: policies.resumeWorker, terminal: () => openTerminal(net, id, () => changes(id)) });
  }
  function changes(id: string) { if (store.workers.has(id)) openChanges(net, id, () => openWorker(id)); }
  const policies = workerPolicies({ net, plan: () => ({ byId: DESK_BY_ID }), openWorkerTerminal: openWorker, openWorkerChanges: changes, hire, officeIsFull });
  function sendToWorker(title: string, text: { initial?: string; context?: string } = {}, issue?: number) {
    if (!g.playable()) return;
    const desk = nextFreeSeat(id => !!store.workerAtDesk(id), store.floorPlan.wing);
    const awake = [...store.workers.values()].filter(w => w.kind === 'agent' && !isAsleep(w.status));
    if (!desk && !awake.length) return toast('All desks are taken', 'warn');
    openAsk({ title, ...text, newDesk: desk && !officeFull(store.machine) ? desk.label : undefined, workers: awake.map(w => ({ id: w.id, name: w.name, color: w.color, status: w.status })), providerOption: true, worktreeOption: !!store.project?.branch, repoOptions: repoChoices(),
      onSubmit: (prompt, to, worktree, provider, model, effort, repos) => {
        if (!g.playable()) return;
        if (to && store.workers.has(to)) net.send({ t: 'worker.prompt', workerId: to, prompt, issue });
        else if (!to && desk) hire(desk.id, prompt, worktree, provider, model, effort, issue, repos);
      },
    });
  }
  const boardActions: BoardActions = {
    queue: (prompt, title, issue, provider, model, effort) => net.send({ t: 'queue.add', prompt, title, issue, provider, model, effort }),
    assign: (prompt, title, issue) => sendToWorker(title, { initial: prompt }, issue), ask: (context, title) => sendToWorker(title, { context }),
    goToDesk: id => { const w = store.workerAtDesk(id); if (w) { closeAllModals(); openWorker(w.id); } },
    meeting: preset => openMeeting(net, { openTerminal: openWorker, openPr: id => { const w = store.workers.get(id); if (w?.pr) window.open(w.pr.url, '_blank', 'noopener'); } }, preset),
  };
  const destinations = {
    issues: () => openBoard('issues', net, boardActions), pulls: () => openBoard('pulls', net, boardActions), queue: () => openQueue(net, { openTerminal: openWorker }),
    manager: () => policies.askStation('station-manager'), plans: () => openPlanReview(net, openWorker), new: () => sendToWorker('New task'),
  };
  return { ...policies, openWorker, destinations };
}
export type Actions = ReturnType<typeof installActions>;
