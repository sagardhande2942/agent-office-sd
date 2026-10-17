/** Stable, versioned fixture slots. Structural surfaces and simulated activities stay fixed. */
export const RENOVATION_SLOTS = {
  desks: { count: 16, label: 'Desk' },
  kiosks: { count: 4, label: 'Agent kiosk' },
  boards: { count: 4, label: 'Board / sign' },
  tv: { count: 1, label: 'Lounge TV' },
  monitor: { count: 1, label: 'Machine monitor' },
  lounge: { count: 5, label: 'Lounge furniture' },
  kitchen: { count: 1, label: 'Kitchen' },
  lamps: { count: 5, label: 'Ceiling lamp' },
  bookshelf: { count: 1, label: 'Bookshelf' },
  lore: { count: 1, label: 'Knowledge shelf' },
  cabinet: { count: 1, label: 'Arcade cabinet' },
} as const;
export type RenovationSlot = keyof typeof RENOVATION_SLOTS;
export const renovationId = (slot: RenovationSlot, index: number) => `renovation-v1-${slot}-${index}`;
export const RENOVATION_IDS = new Set(Object.entries(RENOVATION_SLOTS).flatMap(([slot, { count }]) =>
  Array.from({ length: count }, (_, i) => renovationId(slot as RenovationSlot, i))));
