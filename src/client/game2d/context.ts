import { ROOF } from '../../shared/rooftop';
import { Messages, Keys, Ticks, Interactions } from '../core/registry';
import { Net } from '../net';
import { store, loadProfile, lastSpot } from '../state';
import type { ServerMsg } from '../../shared/protocol';
import { SPAWN } from '../../shared/layout';
import { officeNav, type Pt } from '../../shared/nav';
import { $, modalOpen } from '../ui/dom';
import { Walker } from './navigation';

export interface Target { kind: 'desk' | 'station' | 'board' | 'plans'; id: string; x: number; z: number; label: string }
export interface Uses { it: Target; hint: string; key: string; note: null }
export function createGame() {
  const saved = loadProfile();
  if (saved) Object.assign(store.profile, saved, { look: saved.look ?? store.profile.look });
  const canvas = $('office-map') as HTMLCanvasElement;
  const walker = new Walker(officeNav(), [SPAWN.x, SPAWN.z]);
  const net = new Net(() => store.profile, () => store.floor ? { floor: store.floor, name: store.currentFloor()?.name ?? '', map: 'office', x: walker.at[0], y: 0, z: walker.at[1], facing: walker.facing } : lastSpot());
  return {
    store, canvas, walker, net,
    messages: new Messages<ServerMsg>(m => store.apply(m)), keys: new Keys<KeyboardEvent>(), ticks: new Ticks(), interactions: new Interactions<Uses>(),
    held: new Set<string>(), peers: new Map<string, Pt>(),
    transform: { scale: 1, ox: 0, oz: 0 },
    ready: false, transitioning: false,
    playable() { return this.ready && !this.transitioning && net.up && !!store.floor && store.floor !== ROOF && store.map.pick === 'office'; },
    controls() { return this.playable() && !modalOpen(); },
    stop() { this.held.clear(); walker.stop(); },
  };
}
export type Game = ReturnType<typeof createGame>;
