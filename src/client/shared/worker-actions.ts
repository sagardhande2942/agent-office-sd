/** Scene-independent worker policies shared by the playable clients. */
import { STATION_AGENT, type DeskDef } from '../../shared/layout';
import { pressureNote } from '../../shared/machine';
import type { AgentEffort, AgentProvider, WorkerInfo } from '../../shared/protocol';
import { isAsleep, isBusy } from '../../shared/status';
import type { Net } from '../net';
import { store } from '../state';
import { repoChoices } from './hiring';
import { STATION_INFO } from './station-info';
import { openPrompt, confirmDialog, lostWorktreeDialog, sendHomeDialog } from '../ui/prompt';
import { openTerminal } from '../ui/terminal';
import { providerLabel } from '../ui/provider';
import { toast } from '../ui/dom';

export interface WorkerPolicyDeps {
  net: Net;
  plan: () => { byId: Map<string, DeskDef> };
  openWorkerTerminal: (id: string) => void;
  openWorkerChanges: (id: string) => void;
  hire: (deskId: string, prompt?: string, worktree?: boolean, provider?: AgentProvider, model?: string, effort?: AgentEffort, issue?: number, repos?: string[]) => void;
  officeIsFull: () => boolean;
}
export function workerPolicies({ net, plan, openWorkerTerminal, openWorkerChanges, hire, officeIsFull }: WorkerPolicyDeps) {
  function promptAtDesk(deskId: string) {
    const w = store.workerAtDesk(deskId);
    const desk = plan().byId.get(deskId)!;
    if (!w) {
      if (officeIsFull()) return;
      openPrompt({
        title: `✨ New task at ${desk.label}`,
        subtitle: 'A fresh worker will sit down and start on this right away.',
        warning: pressureNote(store.machine),
        submitLabel: 'Hire & start',
        providerOption: true,
        worktreeOption: !!store.project?.branch,
        repoOptions: repoChoices(),
        onSubmit: (text, o) => hire(deskId, text, o.worktree, o.provider, o.model, o.effort, undefined, o.repos),
      });
    } else if (w.lost) {
      fixLostWorktree(w);
    } else if (isAsleep(w.status)) {
      toast(`${w.name} is asleep — press R to resume first`, 'warn');
    } else if (w.kind === 'shell') {
      openPrompt({
        title: `🐚 Run in ${w.name}`,
        placeholder: 'npm run dev',
        submitLabel: 'Run ▶',
        onSubmit: (text) => net.send({ t: 'worker.prompt', workerId: w.id, prompt: text }),
      });
    } else {
      openPrompt({
        title: `💬 Prompt ${w.name}`,
        subtitle: w.status === 'working' ? `${w.name} is busy — your message will be queued in their input box.` : undefined,
        onSubmit: (text) => net.send({ t: 'worker.prompt', workerId: w.id, prompt: text }),
      });
    }
  }

  function helperFor(w: WorkerInfo) {
    if (officeIsFull()) return;
    if (w.helper) return toast(`${w.name} is itself a helper`, 'warn');
    if (w.lost) return fixLostWorktree(w);
    if (store.helpers.some((h) => h.hostId === w.id)) return toast(`${w.name} already has a helper at its desk`, 'warn');
    openPrompt({
      title: `🆘 Bring a helper to ${w.name}`,
      subtitle: 'It walks over, reads what they are stuck on, tells them what it found, and goes home. It cannot edit, commit or open a pull request.',
      submitLabel: 'Bring them over',
      allowEmpty: true,
      providerOption: true,
      onSubmit: (_text, o) => {
        net.send({ t: 'worker.helper', hostId: w.id, provider: o.provider, model: o.model, effort: o.effort });
      },
    });
  }

  function hireAtDesk(deskId: string) {
    const desk = plan().byId.get(deskId)!;
    if (officeIsFull()) return;
    openPrompt({
      title: `✨ Hire a worker at ${desk.label}`,
      subtitle: 'You can start with an empty prompt and send work later.',
      warning: pressureNote(store.machine),
      placeholder: 'Optional first task…',
      submitLabel: 'Hire & start',
      allowEmpty: true,
      providerOption: true,
      worktreeOption: !!store.project?.branch,
      repoOptions: repoChoices(),
      onSubmit: (text, o) => hire(deskId, text || undefined, o.worktree, o.provider, o.model, o.effort, undefined, o.repos),
    });
  }

  function killWorker(id: string) {
    const w = store.workers.get(id);
    if (!w) return;
    const where = plan().byId.get(w.deskId)?.label ?? 'the desk';
    const session = w.kind === 'shell' ? 'shared shell' : `${providerLabel(w.provider, store.project)} session`;
    if (w.meeting) {
      // The meeting's worktree is the whole table's: it's tidied away once they've all gone.
      const m = store.meeting.current;
      const on = m?.id === w.meeting && m.status === 'running';
      confirmDialog(`Send ${w.name} home?`, on ? `${w.name} is in the meeting on “${m.title}”, which stops without it.` : `${w.name} leaves the meeting room.`, 'Send home', () => net.send({ t: 'worker.kill', workerId: id }));
      return;
    }
    if (w.worktree) {
      // A worker with its own worktree: choose what becomes of the worktree and its branch.
      sendHomeDialog({
        workerId: id,
        name: w.name,
        where,
        worktree: w.worktree,
        repos: w.repos?.length ? [w.worktree.path.split('/').pop() ?? 'its own', ...w.repos.map((r) => r.name)] : undefined,
        ask: () => net.send({ t: 'worker.worktree', workerId: id }),
        onConfirm: (cleanup) => net.send({ t: 'worker.kill', workerId: id, cleanup }),
      });
      return;
    }
    const body = plan().byId.get(w.deskId)?.station
      ? `This stops its ${session} for everyone, and it forgets what it was asked. The next prompt at the ${where} starts a fresh one.`
      : `This stops the ${session} at ${where} for everyone and frees the desk.`;
    confirmDialog(`Send ${w.name} home?`, body, 'Send home', () => net.send({ t: 'worker.kill', workerId: id }));
  }

  function askStation(deskId: string) {
    const kind = plan().byId.get(deskId)?.station;
    if (!kind) return;
    const w = store.workerAtDesk(deskId);
    const name = STATION_AGENT[kind].name;
    const info = STATION_INFO[kind];
    // A prompt typed into a question it's asking would answer it.
    if (w?.status === 'needs_input') {
      toast(`The ${name} is waiting on an answer — here's its terminal`, 'warn');
      return openWorkerTerminal(w.id);
    }
    // Nobody there yet: asking hires the agent.
    if (!w && officeIsFull()) return;
    const subtitle = !w
      ? `${info.does}, in a terminal of my own: press O at the kiosk to watch.`
      : isAsleep(w.status)
        ? `The ${name} is asleep: this wakes it up, and it carries on where it left off.`
        : isBusy(w.status)
          ? `The ${name} is busy. Your prompt waits in its input box until it's done.`
          : undefined;
    openPrompt({
      title: `${info.icon} Ask the ${name}`,
      subtitle,
      placeholder: `e.g. ${info.example}`,
      submitLabel: 'Send ✨',
      warning: w ? undefined : pressureNote(store.machine),
      // The agent it starts on, when this hire brings it: the office default, or whichever one you
      // pick here. Asking one that's already there goes to the agent that is, whatever it runs on.
      providerOption: !w,
      onSubmit: (text, opts) => net.send({ t: 'station.prompt', deskId, prompt: text, ...(opts.picked ? { provider: opts.provider, ...(opts.model ? { model: opts.model } : {}), ...(opts.effort ? { effort: opts.effort } : {}) } : {}) }),
    });
  }

  function resumeWorker(w: WorkerInfo) {
    if (w.lost) return fixLostWorktree(w);
    if (!w.sessionId && w.kind !== 'shell') toast(`${w.name} has no saved Claude session — starting a fresh one`, 'warn');
    net.send({ t: 'worker.resume', workerId: w.id });
  }

  function fixLostWorktree(w: WorkerInfo) {
    if (!w.lost || !w.worktree) return;
    const others = [...store.workers.values()].filter((o) => o.lost && o.id !== w.id);
    lostWorktreeDialog({
      name: w.name,
      worktree: w.worktree,
      lost: w.lost,
      workspace: w.repos?.length ? w.worktree.path.replace(/[\\/][^\\/]*$/, '') : undefined,
      others: others.map((o) => o.name),
      openTerminal: isAsleep(w.status) ? undefined : () => openTerminal(net, w.id, () => openWorkerChanges(w.id)),
      rebuild: (all) => {
        toast(all ? `Rebuilding ${others.length + 1} worktrees…` : `Rebuilding ${w.name}'s worktree…`);
        net.send({ t: 'worker.rebuild', workerId: w.id, all });
      },
      sendHome: () => killWorker(w.id),
    });
  }
  return { promptAtDesk, helperFor, hireAtDesk, killWorker, askStation, resumeWorker, fixLostWorktree };
}
