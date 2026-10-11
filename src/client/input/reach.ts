import type { Vector3 } from 'three';
import type { Interactable } from '../world/types';

/** A desk's screen, keyboard and worker share the reach of its interaction spot. */
export function withinInteractionReach(it: Interactable, hit: Vector3, eye: Vector3, feet: Vector3, limit: number): boolean {
  if (hit.distanceTo(eye) <= limit) return true;
  // Keep the existing surface reach, but don't make a nearby laptop's far edge harder to use.
  // The floor height matters for desks upstairs and helpers carrying laptops downstairs.
  return it.kind === 'desk' && Math.hypot(it.x - feet.x, (it.y ?? 0) - feet.y, it.z - feet.z) <= limit;
}
