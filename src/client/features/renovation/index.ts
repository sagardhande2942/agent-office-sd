import { FLOOR, WING, SEATING_BY_ID, seatPlace, wingMinZ } from '../../../shared/layout';
import { NavGrid } from '../../../shared/nav';
import { registerOfficeNavigationSource } from '../../../shared/navigation-source';
import { placementRevision } from '../object-placement/model';
import type { Ctx } from '../../core/context';
import { h } from '../../ui/dom';
import { PLACEMENT_TOOLS } from '../object-placement/extensions';
import type { Collider } from '../../world/types';

export function installRenovation(ctx: Ctx) {
  let revision = -1;
  const grids = new Map<number, NavGrid>();
  registerOfficeNavigationSource(wing => {
    if (revision !== placementRevision) { grids.clear(); revision = placementRevision; }
    let grid = grids.get(wing);
    if (!grid) {
      const bounds = { ...FLOOR, minZ: wingMinZ(wing) };
      grid = new NavGrid(bounds, {
        rects: ctx.office.colliders.filter(c => c.top > .3 && (c.bottom ?? 0) < 1.7
          && c.maxX > bounds.minX && c.minX < bounds.maxX && c.maxZ > bounds.minZ && c.minZ < bounds.maxZ)
          .map(c => [c.minX, c.maxX, c.minZ, c.maxZ]), circles: [],
      }, (x, z, margin) => (x > FLOOR.minX + margin && x < FLOOR.maxX - margin && z > FLOOR.minZ + margin && z < FLOOR.maxZ - margin)
        || (wing > 0 && x > WING.minX + margin && x < WING.maxX - margin && z > wingMinZ(wing) + margin && z < FLOOR.maxZ - margin));
      grids.set(wing, grid);
    }
    return grid;
  });
  let editing = false, walkThrough = true;
  let original: Collider[] | null = null, filtered: Collider[] | null = null;
  const obstacles = new Set<Collider>();
  function restore() {
    if (original && ctx.player.colliders === filtered) ctx.player.colliders = original;
    original = filtered = null;
  }
  PLACEMENT_TOOLS.push(context => {
    editing = true; obstacles.clear();
    for (const e of context.entries) {
      if (e.collider) obstacles.add(e.collider);
      for (const c of e.colliders ?? []) obstacles.add(c);
    }
    const picker = h('select', { 'aria-label': 'Office object' }, h('option', { value: '' }, 'Choose an object…'),
      ...context.entries.map((e, i) => {
        const duplicates = context.entries.filter(other => other.label === e.label);
        const label = duplicates.length > 1 ? `${e.label} ${context.entries.slice(0, i + 1).filter(other => other.label === e.label).length}` : e.label;
        return h('option', { value: e.id }, label);
      }));
    picker.onchange = () => context.select(context.entries.find(e => e.id === picker.value) ?? null);
    const checkbox = h('input', { type: 'checkbox', checked: walkThrough });
    checkbox.onchange = () => { walkThrough = checkbox.checked; if (!walkThrough) restore(); };
    return {
      element: h('div.renovation-tools', {}, h('label', {}, 'Object ', picker),
        h('label', {}, checkbox, ' Walk through furniture while renovating'),
        h('p', {}, 'Objects can overlap. Walls, floors, stairs and activity fixtures stay fixed.')),
      refresh: () => { picker.value = context.selected()?.id ?? ''; },
      close: () => { editing = false; restore(); obstacles.clear(); },
    };
  });
  ctx.ticks.add('pre', () => {
    const seated = ctx.player.seat;
    const seat = seated && ctx.inOffice() && SEATING_BY_ID.get(seated.seatId);
    if (seated && seat) {
      const index = Number(seated.key.slice(seated.key.lastIndexOf(':') + 1));
      if (Number.isInteger(index) && index >= 0 && index < seat.places.length) {
        const next = seatPlace(seat, index);
        if (['x', 'y', 'z', 'rotY', 'hips'].some(k => next[k as keyof typeof next] !== seated[k as keyof typeof seated])) {
          ctx.player.sit(next); ctx.me.sit(next.hips);
        }
      }
    }
    if (!editing || !walkThrough || !ctx.inOffice() || ctx.trip() || ctx.upTop()) { restore(); return; }
    if (ctx.player.colliders !== filtered) original = ctx.player.colliders;
    if (!original) return;
    filtered = original.filter(c => !obstacles.has(c));
    ctx.player.colliders = filtered;
  });
}
