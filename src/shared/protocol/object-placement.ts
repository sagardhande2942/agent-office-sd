import type { ObjectTransform, PlacementState } from '../object-placement.js';
export type PlacementClientMsg = { t: 'placement.set'; floor: string; map: string; id: string; transform: ObjectTransform; request: number; final: boolean; onlyIfMissing?: boolean };
export type PlacementServerMsg =
  | { t: 'placement.changed'; floor: string; map: string; id: string; transform: ObjectTransform; by: string; request: number; saved: boolean }
  | { t: 'placement.rejected'; floor: string; map: string; id: string; request: number; transform: ObjectTransform; reason: string };
export interface PlacementView { map: string; items: PlacementState }
