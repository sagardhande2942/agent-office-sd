export const FPS_OPTIONS = [30, 60, 90, 120, 'display'] as const;
export type Fps = typeof FPS_OPTIONS[number];
const KEY = 'agent-office.performance';
export function parseFps(value: unknown): Fps {
  return FPS_OPTIONS.includes(value as Fps) ? value as Fps : 60;
}
export function loadFps(): Fps {
  try { return parseFps(JSON.parse(localStorage.getItem(KEY) ?? 'null')); }
  catch { return 60; }
}
export function saveFps(value: Fps) {
  try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* Applies for this visit. */ }
}
export function effectiveFps(fps: Fps, hidden: boolean, blocked: boolean): number | null {
  if (hidden) return null;
  if (blocked) return 15;
  return fps === 'display' ? 0 : fps;
}
