import { ROOF } from '../../shared/rooftop';
import type { Game } from './context';
import { rememberSpot } from '../state';
export function installPresence(g: Game) {
  let sent = 0, wasMoving = false;
  g.ticks.add('me', f => {
    if (!g.ready || !g.net.up || !g.store.floor || g.store.floor === ROOF || g.store.map.pick !== 'office') return;
    const moving = g.walker.moving && g.controls();
    if (f.now - sent < 100 && moving === wasMoving) return;
    if (!moving && !wasMoving && f.now - sent < 1000) return;
    sent = f.now; wasMoving = moving;
    const [x, z] = g.walker.at;
    g.net.send({ t: 'move', x, y: 0, z, rotY: g.walker.facing, moving });
    rememberSpot({ floor: g.store.floor, name: g.store.currentFloor()?.name ?? '', map: 'office', x, y: 0, z, facing: g.walker.facing });
  });
  g.ticks.add('others', f => {
    const visible = new Set<string>();
    for (const p of g.store.peers.values()) {
      if (p.id === g.store.you || p.floor !== g.store.floor || p.lite) continue;
      visible.add(p.id);
      const at = g.peers.get(p.id) ?? [p.x, p.z];
      const blend = 1 - Math.exp(-12 * f.dt);
      g.peers.set(p.id, [at[0] + (p.x - at[0]) * blend, at[1] + (p.z - at[1]) * blend]);
    }
    for (const id of g.peers.keys()) if (!visible.has(id)) g.peers.delete(id);
  });
}
