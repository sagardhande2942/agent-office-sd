import type { MeetingSpace } from '../../../shared/meeting-spaces';
/** Identity comes from the persistent ID, so renaming never changes a reality's signature. */
export function realityColor(id: string): string {
  if (id === 'main') return '#79e8ff';
  let hash = 0;
  for (const char of id) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return ['#c8a1ff', '#ffbd7a', '#7df4c3', '#ff8dbb', '#aab9ff'][hash % 5];
}
export function dialReality(spaces: readonly MeetingSpace[], id: string, direction: number): string | undefined {
  if (!spaces.length) return undefined;
  const index = Math.max(0, spaces.findIndex(s => s.id === id));
  return spaces[(index + direction % spaces.length + spaces.length) % spaces.length]?.id;
}
export interface RiftPoint { x: number; y: number; z: number }
/** Segment/plane intersection: walking through the opening counts, skirting it or teleporting does not. */
export function crossedRift(previous: RiftPoint | undefined, next: RiftPoint): boolean {
  if (!previous || previous.z * next.z > 0 || previous.z === next.z) return false;
  if (Math.hypot(next.x - previous.x, next.y - previous.y, next.z - previous.z) > 1.5) return false;
  const t = previous.z / (previous.z - next.z);
  if (t < 0 || t > 1) return false;
  const x = previous.x + (next.x - previous.x) * t;
  const y = previous.y + (next.y - previous.y) * t;
  return (x / 0.9) ** 2 + ((y - 1.25) / 1.5) ** 2 < 1;
}
