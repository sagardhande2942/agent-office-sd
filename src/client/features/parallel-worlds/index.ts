import { WORLD_APPROACHES, type WorldsResponse } from '../../../shared/parallel-worlds';
import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { HUD_ACTIONS } from '../../ui/menu';
import type { Modal } from '../../ui/dom';
import { PALETTE_ENTRIES } from '../palette';
import { openWorlds, type WorldsUI } from './ui';
import { buildWorldPortals } from './world';

declare module '../../world/types' { interface InteractKinds { worldportal: true; } }

export function installParallelWorlds(ctx: Ctx, parts: Pick<Parts, 'waiting'>) {
  let state: WorldsResponse = { experiments: [] };
  let version = 0;
  let pending: Promise<void> | undefined;
  let modal: Modal | undefined;
  let floorSeen: string | null = null;
  async function refresh() {
    const floor = store.floor;
    if (!floor) { state = { experiments: [] }; return; }
    if (pending) return pending;
    const serial = version;
    pending = (async () => {
      const response = await fetch(`/api/parallel-worlds?floor=${encodeURIComponent(floor)}`);
      const body = await response.json() as WorldsResponse;
      if (serial !== version || store.floor !== floor) return;
      if (!response.ok) throw Error(body.error ?? 'Cannot load parallel worlds');
      state = body;
      const current = state.experiments.find(e => !e.archived);
      portals.rename(current?.worlds.map(w => w.name) ?? WORLD_APPROACHES.map(w => w.name));
    })().finally(() => { if (serial === version) pending = undefined; });
    return pending;
  }
  const ui: WorldsUI = { state: () => state, refresh, send: message => ctx.net.send(message), terminal: id => parts.waiting.openWorkerTerminal(id) };
  const open = (index?: number) => { modal?.close(); modal = openWorlds(ui, index); };
  HUD_ACTIONS.push({ id: 'parallel-worlds', icon: '🌀', label: 'Parallel worlds', section: 'Open', run: () => open() });
  PALETTE_ENTRIES.push(() => [{ icon: '🌀', kind: 'Action', title: 'Parallel worlds', keywords: ['universe', 'experiment', 'variants', 'portals'], open: () => open() }]);
  const portals = buildWorldPortals();
  ctx.scene.add(portals.root);
  portals.root.visible = false;
  ctx.usables.add({ usable: () => portals.root.visible ? portals.interactables : [], pickable: () => portals.root });
  ctx.interactions.define('worldportal', {
    reach: 3,
    hint: it => {
      const current = state.experiments.find(e => !e.archived);
      const world = current?.worlds[Number(it.deskId)];
      return { k: `world:${it.deskId}:${world?.worker?.status ?? 'new'}`, parts: [hintTitle(`🌀 ${world?.name ?? 'Parallel worlds'}`), aside(world?.worker?.status ?? 'Create an experiment'), key('E', 'Enter world')] };
    },
    use: onE(it => open(Number(it.deskId))),
  });
  ctx.ticks.add('world', ({ t }) => {
    portals.root.visible = !!store.floor && ctx.inOffice() && !ctx.upTop() && ctx.player.pos.y > -1 && !ctx.trip();
    if (portals.root.visible) portals.update(t, ctx.reduceMotion.matches);
  });
  store.on('floor', () => {
    if (floorSeen === store.floor) return;
    floorSeen = store.floor; version++; pending = undefined;
    state = { experiments: [] }; modal?.close();
    void refresh().catch(() => {});
  });
  ctx.messages.on('worlds.changed', message => { if (message.floor === store.floor) void refresh().catch(() => {}); });
}
