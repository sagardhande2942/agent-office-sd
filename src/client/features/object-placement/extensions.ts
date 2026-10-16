import type { Editable } from './model';

/** Scene-editing tools register without coupling the editor to individual fixtures. */
export interface PlacementToolContext {
  entries: readonly Editable[];
  select(entry: Editable | null): void;
  selected(): Editable | null;
}
export const PLACEMENT_TOOLS: ((context: PlacementToolContext) => { element: HTMLElement; close?(): void; refresh?(): void })[] = [];
