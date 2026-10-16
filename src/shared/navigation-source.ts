import type { NavGrid } from './nav.js';

/** Optional runtime layout provider; CLI/server callers keep the static office plan. */
let source: ((wing: number) => NavGrid) | undefined;
export const officeNavigationSource = (wing: number) => source?.(wing);
export function registerOfficeNavigationSource(next: (wing: number) => NavGrid) {
  source = next;
  return () => { if (source === next) source = undefined; };
}
