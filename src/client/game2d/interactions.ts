import type { Game, Target } from './context';
import type { Actions } from './actions';
import { targets, worldPoint, workerDesk } from './map';
import { deskPoint } from '../../shared/nav';
import { DESK_BY_ID } from '../../shared/layout';
import { isAsleep } from '../../shared/status';
import { toast } from '../ui/dom';
export function installInteractions(g: Game, actions: Actions) {
  const workerUse = (t: Target, key: string) => {
    const w = g.store.workerAtDesk(t.id);
    if (key === 'E') {
      if (t.kind === 'station') return actions.askStation(t.id);
      if (w) actions.openWorker(w.id);
      else if (DESK_BY_ID.get(t.id)?.review) actions.destinations.plans();
      else if (!DESK_BY_ID.get(t.id)?.room) actions.hireAtDesk(t.id);
    }
    if (key === 'O' && w) actions.openWorker(w.id);
    if (key === 'R' && w && isAsleep(w.status)) actions.resumeWorker(w);
    if (key === 'P') actions.promptAtDesk(t.id);
    if (key === 'U' && w) actions.helperFor(w);
    if (key === 'X' && w) actions.killWorker(w.id);
  };
  for (const kind of ['desk', 'station'] as const) g.interactions.define(kind, { reach: 3, hint: t => t.label, use: workerUse });
  g.interactions.define('board', { reach: 3, hint: t => t.label, use: t => actions.destinations[t.id as 'issues' | 'pulls' | 'queue']() });
  g.interactions.define('plans', { reach: 3, hint: t => t.label, use: () => actions.destinations.plans() });
  const nearest = (x: number, z: number, radius: number) => targets(g).map(t => ({ t, d: Math.hypot(t.x - x, t.z - z) })).filter(t => t.d <= radius).sort((a, b) => a.d - b.d)[0]?.t;
  const use = (t: Target, key: string) => { if (g.controls()) { g.stop(); g.interactions.use(t, key, null); } };
  g.keys.bind({ code: ['KeyE', 'KeyP', 'KeyU', 'KeyX', 'KeyR', 'KeyO'], repeat: false, preventDefault: true, run: e => {
    const t = nearest(...g.walker.at, 3);
    if (t?.kind === 'station' && e.code === 'KeyE') {
      const worker = g.store.workerAtDesk(t.id);
      if (worker && g.controls()) { g.stop(); return actions.openWorker(worker.id); }
    }
    if (t) use(t, e.code.slice(3));
  } });
  g.canvas.addEventListener('click', e => {
    if (!g.controls()) return;
    g.canvas.focus();
    const at = worldPoint(g, e.clientX, e.clientY);
    // A station worker and its kiosk have distinct click targets: the person opens
    // its terminal; the kiosk uses the existing station prompt flow.
    for (const w of g.store.workers.values()) {
      const d = workerDesk(w);
      if (!d) continue;
      const [x, z] = w.helper ? [d.x, d.z] : deskPoint(d, 0, d.station ? 0.55 : 0.9);
      if (Math.hypot(at[0] - x, at[1] - z) <= 0.4) { g.stop(); return actions.openWorker(w.id); }
    }
    const t = nearest(...at, 1.2);
    if (t) return use(t, 'E');
    if (!g.walker.walk(at)) toast('No walkable route to that spot', 'warn');
  });
}
