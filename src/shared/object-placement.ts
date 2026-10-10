import { FLOOR, PLANTS, plantByWing } from './layout.js';

export interface ObjectTransform { position: number[]; rotation: number[]; scale: number[] }
export type PlacementState = Record<string, ObjectTransform>;
/** Explicit office scenery allowlist; seats, anchors and gameplay fixtures cannot be moved over the wire. */
export const PLACEMENT_DEFAULTS: PlacementState = Object.fromEntries([
  ...PLANTS.flatMap(([x, z, s], i) => plantByWing([x, z, s]) ? [] : [[`plant-${i}`, { position: [x, 0, z], rotation: [0, 0, 0], scale: [s, s, s] }]]),
  ...[[-10.5, -4], [-1.5, -4], [-10.5, 4], [-1.5, 4]].map(([x, z]) => [`rug-${x}-${z}`, { position: [x, .011, z], rotation: [0, 0, 0], scale: [1, 1, 1] }]),
  ['lounge-rug', { position: [13.4, .011, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }],
  ['lounge-coffee-table', { position: [13, 0, 0], rotation: [0, 0, 0], scale: [1, 1, 1] }],
]);
export function validPlacement(id: unknown, raw: unknown): raw is ObjectTransform {
  if (typeof id !== 'string' || !Object.hasOwn(PLACEMENT_DEFAULTS, id) || !raw || typeof raw !== 'object') return false;
  const t = raw as ObjectTransform, initial = PLACEMENT_DEFAULTS[id];
  if (![t.position, t.rotation, t.scale].every(a => Array.isArray(a) && a.length === 3 && a.every(n => typeof n === 'number' && Number.isFinite(n)))) return false;
  const factor = t.scale[0] / initial.scale[0];
  return t.position[0] >= FLOOR.minX + .15 && t.position[0] <= FLOOR.maxX - .15
    && t.position[2] >= FLOOR.minZ + .15 && t.position[2] <= FLOOR.maxZ - .15
    && Math.abs(t.position[1] - initial.position[1]) < 1e-6
    && t.rotation[0] === 0 && t.rotation[2] === 0 && Math.abs(t.rotation[1]) <= 1000
    && factor >= .25 && factor <= 3 && t.scale.every((n, i) => Math.abs(n / initial.scale[i] - factor) < 1e-6);
}
