import type { Game } from './context';
import { desks, targets, workerDesk } from './map';
import { PLAN_REVIEW_TABLE, MEETING_TABLE, DESK_SIZE } from '../../shared/layout';
import { deskPoint } from '../../shared/nav';
import { STATUS_LABEL } from '../ui/dom';
import { isAsleep } from '../../shared/status';

export function installRender(g: Game) {
  const ctx = g.canvas.getContext('2d')!;
  g.ticks.add('render', () => {
    const r = g.canvas.getBoundingClientRect(), dpr = devicePixelRatio || 1;
    if (g.canvas.width !== Math.round(r.width * dpr) || g.canvas.height !== Math.round(r.height * dpr)) { g.canvas.width = Math.round(r.width * dpr); g.canvas.height = Math.round(r.height * dpr); }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, r.width, r.height);
    const nav = g.walker.nav, b = nav.bounds;
    const scale = Math.min((r.width - 64) / (b.maxX - b.minX), (r.height - 64) / (b.maxZ - b.minZ));
    const ox = (r.width - (b.maxX + b.minX) * scale) / 2, oz = (r.height - (b.maxZ + b.minZ) * scale) / 2;
    g.transform = { scale, ox, oz };
    const rect = (x: number, z: number, w: number, h: number, color: string) => { ctx.fillStyle = color; ctx.fillRect(ox + x * scale, oz + z * scale, w * scale, h * scale); };
    const text = (x: number, z: number, value: string, color = '#253b45', size = 12, maxWidth = Infinity) => {
      ctx.font = `600 ${size}px system-ui`; ctx.textAlign = 'center'; ctx.fillStyle = '#fffaf0';
      if (ctx.measureText(value).width > maxWidth) {
        while (value.length && ctx.measureText(value + '…').width > maxWidth) value = value.slice(0, -1);
        value += '…';
      }
      const width = ctx.measureText(value).width;
      ctx.fillRect(ox + x * scale - width / 2 - 1, oz + z * scale - size + 2, width + 2, size + 3);
      ctx.fillStyle = color; ctx.fillText(value, ox + x * scale, oz + z * scale);
    };
    const person = (x: number, z: number, color: string, label: string, status?: string) => {
      ctx.beginPath(); ctx.arc(ox + x * scale, oz + z * scale, Math.max(5, scale * 0.3), 0, Math.PI * 2); ctx.fillStyle = color; ctx.fill(); ctx.strokeStyle = '#243b47'; ctx.lineWidth = 2; ctx.stroke();
      text(x, z - 0.45, label, '#253b45', 12, scale * 2.05);
      if (status) text(x, z + 0.95, status, status === 'needs input' ? '#b84516' : '#4d645c', 9);
    };
    rect(b.minX, b.minZ, b.maxX - b.minX, b.maxZ - b.minZ, '#c5b69b');
    // Draw every blocked cell as neutral furniture, including fixtures omitted from this view.
    for (let row = 0; row < nav.rows; row++) for (let col = 0; col < nav.cols; col++) {
      const x = b.minX + col * 0.5, z = b.minZ + row * 0.5;
      if (nav.walkable(x + 0.25, z + 0.25)) rect(x, z, 0.5, 0.5, (row + col) % 2 ? '#f0e5cf' : '#ede1c9');
      else rect(x, z, 0.5, 0.5, '#9aaba6');
    }
    for (const d of desks(g)) {
      if (d.id.startsWith('helper:')) continue;
      const w = d.station ? 0.9 : d.beanbag || d.room || d.review ? 0.7 : DESK_SIZE.width;
      const h = d.station ? 0.5 : d.room || d.review ? 0.5 : DESK_SIZE.depth;
      rect(d.x - w / 2, d.z - h / 2, w, h, d.station ? '#6b99a7' : '#bd8e60');
      if (!g.store.workerAtDesk(d.id) && !d.station && !d.room && !d.review) text(d.x, d.z + 0.15, d.label, '#75634f', 10);
    }
    for (const t of [MEETING_TABLE, PLAN_REVIEW_TABLE]) rect(t.x - t.width / 2, t.z - t.depth / 2, t.width, t.depth, '#ac815d');
    for (const t of targets(g).filter(t => t.kind !== 'desk')) {
      if (t.kind === 'board') rect(t.x - 2, t.z, 4, 0.6, '#648695');
      if (t.kind === 'station' && t.id !== 'station-manager') continue;
      text(t.x, t.z + (t.kind === 'board' ? 0.55 : 0.2), t.id === 'station-manager' ? 'Manager' : t.kind === 'station' ? '' : t.label, '#274853');
    }
    for (const w of g.store.workers.values()) {
      const d = workerDesk(w);
      if (!d) continue;
      const [x, z] = w.helper ? [d.x, d.z] : deskPoint(d, 0, d.station ? 0.55 : 0.9);
      person(x, z, w.color, w.name, isAsleep(w.status) ? 'offline' : STATUS_LABEL[w.status] ?? w.status);
    }
    for (const [id, at] of g.peers) { const p = g.store.peers.get(id); if (p) person(...at, p.color, p.name); }
    if (g.ready && g.store.map.pick === 'office') person(...g.walker.at, g.store.profile.color, `${g.store.profile.name} (you)`);
    if (g.walker.path.length) {
      ctx.beginPath(); ctx.moveTo(ox + g.walker.at[0] * scale, oz + g.walker.at[1] * scale);
      for (const p of g.walker.path) ctx.lineTo(ox + p[0] * scale, oz + p[1] * scale);
      ctx.strokeStyle = '#347b95'; ctx.lineWidth = 2; ctx.stroke();
    }
  });
}
