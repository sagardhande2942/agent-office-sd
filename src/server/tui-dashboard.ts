import { contextLabel } from '../shared/communications.js';
import { builtDesks } from '../shared/layout.js';
import type { FloorInfo, FloorView, WorkerInfo } from '../shared/protocol.js';

export const PANELS = ['office', 'issues', 'pulls', 'queue', 'messages', 'floors', 'help'] as const;
export type Panel = typeof PANELS[number];
export interface Seat { id: string; label: string; worker?: WorkerInfo }
export interface Dashboard {
  view?: FloorView;
  floors: FloorInfo[];
  selected: number;
  panel: Panel;
  offset: number;
  notice: string;
  command?: string;
  thread?: string;
}

/** Dashboard text is untrusted; only attached PTYs may emit terminal controls. */
export function plain(value: string): string {
  return value.replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
}
const fit = (text: string, width: number) => plain(text).replace(/[^\x20-\x7e]/g, '?').slice(0, width).padEnd(width);
const statusColor = (worker?: WorkerInfo) => !worker ? 90 : worker.status === 'needs_input' ? 33 : worker.status === 'done' ? 32 : worker.status === 'working' ? 36 : 37;

export function seats(view?: FloorView): Seat[] {
  if (!view?.floor) return [];
  const desks = builtDesks(view.plan.wing).sort((a, b) => a.z - b.z || a.x - b.x);
  const result: Seat[] = desks.map((d) => ({ id: d.id, label: view.plan.labels[d.id]?.text || d.label, worker: view.workers.find((w) => w.deskId === d.id) }));
  for (const w of view.workers) if (!result.some((s) => s.worker?.id === w.id)) result.push({ id: w.id, label: w.helper ? 'Helper' : w.deskId, worker: w });
  return result;
}

export function gridColumns(width: number): number {
  const gridWidth = width >= 100 ? width - 34 : width;
  return Math.max(1, Math.floor((gridWidth + 1) / 25));
}

export function communicationLines(state: Dashboard, width: number): string[] {
  const messages = state.view?.communications?.messages ?? [];
  const roots = messages.filter((m) => m.kind === 'request').reverse();
  if (!state.thread) return roots.length ? roots.map((m, i) => `${i === state.offset ? '>' : ' '} [${m.status}] ${m.from.name} -> ${m.to.name}: ${m.text}`) : [state.view?.communications?.error ?? 'No worker requests yet. Enter opens a selected thread.'];
  const root = messages.find((m) => m.id === state.thread);
  if (!root) return ['Request no longer retained.'];
  return [root, ...messages.filter((m) => m.threadId === root.id && m.id !== root.id)].flatMap((m) => [
    `${m.from.name} -> ${m.to.name} [${m.status}]`, m.id, ...m.text.split('\n'), contextLabel(m.context), '',
  ]).flatMap((line) => {
    const clean = plain(line).replace(/[^\x20-\x7e]/g, '?');
    return Array.from({ length: Math.max(1, Math.ceil(clean.length / width)) }, (_, i) => clean.slice(i * width, (i + 1) * width));
  });
}

/** Pure renderer: every row fits the terminal, and the selected desk stays in view. */
export function renderDashboard(state: Dashboard, width: number, height: number): string {
  width = Math.max(1, Math.floor(width)); height = Math.max(1, Math.floor(height));
  const view = state.view, all = seats(view), selected = Math.min(state.selected, Math.max(0, all.length - 1));
  const attention = view?.workers.filter((w) => w.status === 'needs_input' || w.status === 'done').length ?? 0;
  const name = state.floors.find((f) => f.id === view?.floor)?.name ?? 'No project';
  const bodyHeight = Math.max(1, height - 6);
  const lines = [fit(`AGENT OFFICE / ${name}    ${view?.workers.length ?? 0} workers | ${attention} need attention | Desk ${all.length ? selected + 1 : 0}/${all.length}`, width),
    fit(PANELS.map((p) => p === state.panel ? `[${p.toUpperCase()}]` : p).join('   '), width), '-'.repeat(width)];
  let body: string[] = [];
  if (state.panel === 'office' && all.length) {
    const columns = gridColumns(width), cardWidth = Math.min(24, width), side = width >= 100;
    const pageRows = Math.max(1, Math.floor(bodyHeight / 5));
    const start = Math.floor(Math.floor(selected / columns) / pageRows) * pageRows * columns;
    for (let index = start; index < Math.min(all.length, start + pageRows * columns); index += columns) {
      const row = all.slice(index, index + columns);
      for (let y = 0; y < 5; y++) {
        body.push(row.map((seat, x) => {
          const w = seat.worker, active = index + x === selected;
          const content = y === 0 ? `${active ? '>' : ' '} ${seat.label}` : y === 1 ? w?.name ?? 'Empty desk' : y === 2 ? w?.provider ?? w?.kind ?? 'Enter to hire' : y === 3 ? w?.status ?? 'available' : '-'.repeat(cardWidth - 2);
          return `\x1b[${active ? '7;' : ''}${statusColor(w)}m${fit(content, cardWidth)}\x1b[0m`;
        }).join(' '));
      }
    }
    if (side) {
      const w = all[selected]?.worker;
      const details = w ? ['SELECTED WORKER', w.name, w.id, `Status: ${w.status}`, `Agent: ${w.provider ?? w.kind}`, '', w.task?.name ?? '', w.task?.summary ?? w.activity ?? '', '', `By: ${w.createdBy}`, w.pr ? `PR #${w.pr.number}` : '', 'Enter: live terminal', 'p: prompt   r: resume'] : ['EMPTY DESK', all[selected]?.label ?? '', '', 'Enter: hire here', '', 'h: hire an agent', ': command prompt'];
      const gridWidth = width - 34;
      body = Array.from({ length: bodyHeight }, (_, i) => {
        const grid = body[i] ?? '';
        const visible = plain(grid).length;
        return grid + ' '.repeat(Math.max(0, gridWidth - visible)) + ' | ' + fit(details[i] ?? '', 31);
      });
    }
  } else if (state.panel === 'office') body = ['No project floors yet. Add a project in the browser office.', 'Press f to choose a floor, or : for commands.'].map((line) => fit(line, width));
  else if (state.panel === 'floors') body = state.floors.map((f, i) => `${i === state.offset ? '>' : ' '} ${f.id === view?.floor ? '*' : ' '} ${f.name}  ${f.id}${f.cloning ? ' (cloning)' : ''}`);
  else if (state.panel === 'issues' || state.panel === 'pulls') {
    const board = state.panel === 'issues' ? view?.issues : view?.pulls;
    body = board?.items.map((item) => `#${item.number}  ${item.title}`) ?? [];
    if (!body.length) body = [board?.error ?? 'No items on this board.'];
  } else if (state.panel === 'queue') body = view?.queue.tasks.map((t) => `${t.status.padEnd(8)} ${t.title} ${t.workerName ? '(' + t.workerName + ')' : ''}`) ?? [];
  else if (state.panel === 'messages') body = communicationLines(state, width);
  else body = ['Arrow keys: select a desk or scroll a board', 'Enter: attach to worker / hire at empty desk / switch floor', 'Tab: next panel    f: floors    n: next worker needing attention', 'h: hire    p: prompt selected worker    r: resume worker', 'i: issues    b: pull requests    t: task queue    m: messages', 'c: chat    : open command prompt    ?: help', 'Esc: cancel command / return to office    q or Ctrl+C: quit', 'Attached terminal: Ctrl+] returns to the office', '', 'Commands: hire <provider> [prompt], prompt <worker> <text>,', 'resume <worker>, pr <worker>, go <floor>, enqueue <text>,', 'chat <text>, messages [request-id], issues, pulls, queue, floors, quit'];
  if (state.panel !== 'office') {
    const start = state.panel === 'floors' || (state.panel === 'messages' && !state.thread) ? Math.floor(state.offset / bodyHeight) * bodyHeight : state.offset;
    body = body.slice(start, start + bodyHeight).map((line) => fit(line, width));
  }
  lines.push(...Array.from({ length: bodyHeight }, (_, i) => body[i] ?? ''));
  lines.push('-'.repeat(width), fit(state.notice, width), fit(state.command !== undefined ? ':' + state.command.slice(-Math.max(0, width - 2)) + '_' : 'Arrows select | Enter open | Tab panels | f floors | h hire | : command | q quit', width));
  return lines.slice(0, height).join('\r\n');
}
