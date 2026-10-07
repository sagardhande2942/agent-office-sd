import { helperDesk, helperHost } from '../../shared/helper';
import type { WorkerInfo } from '../../shared/protocol';
import { BOARDS, DESK_BY_ID, PLAN_REVIEW_TABLE, STATIONS, builtDesks, BEANBAGS, MEETING_SEATS, PLAN_REVIEW_SEATS } from '../../shared/layout';
import { deskPoint } from '../../shared/nav';
import type { Game, Target } from './context';

export function workerDesk(w: WorkerInfo) {
  const host = helperHost(w.deskId);
  const d = DESK_BY_ID.get(host ?? w.deskId);
  return host && d ? helperDesk(d, w.name) : d;
}
export function desks(g: Game) {
  const all = new Map([...builtDesks(g.store.floorPlan.wing), ...BEANBAGS, ...STATIONS, ...MEETING_SEATS, ...PLAN_REVIEW_SEATS].map(d => [d.id, d]));
  for (const w of g.store.workers.values()) { const d = workerDesk(w); if (d) all.set(d.id, d); }
  return [...all.values()];
}
export function targets(g: Game): Target[] {
  return [
    ...desks(g).map(d => {
      const [x, z] = d.id.startsWith('helper:') ? [d.x, d.z] : deskPoint(d, 0, d.station ? 0 : 0.9);
      return { kind: d.station ? 'station' as const : 'desk' as const, id: d.id, x, z, label: g.store.workerAtDesk(d.id)?.name ?? d.label };
    }),
    ...(['issues', 'pulls', 'queue'] as const).map(id => ({ kind: 'board' as const, id, x: BOARDS[id].x, z: BOARDS[id].z, label: id === 'pulls' ? 'PRs' : id === 'queue' ? 'Queue' : 'Issues' })),
    { kind: 'plans', id: 'plans', x: PLAN_REVIEW_TABLE.x, z: PLAN_REVIEW_TABLE.z, label: 'Plan Comparison' },
  ];
}
export function worldPoint(g: Game, clientX: number, clientY: number): [number, number] {
  const r = g.canvas.getBoundingClientRect(), { scale, ox, oz } = g.transform;
  return [(clientX - r.left - ox) / scale, (clientY - r.top - oz) / scale];
}
