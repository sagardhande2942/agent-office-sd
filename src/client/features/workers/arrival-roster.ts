/** Scene projections can disappear while their workers keep running in another meeting reality. */
export class ArrivalRoster {
  private floor: string | null | undefined;
  private known = new Set<string>();

  /** Only workers newly added to the live roster should walk in from the elevator. */
  observe(floor: string | null, ids: Iterable<string>): Set<string> {
    if (floor !== this.floor) { this.floor = floor; this.known.clear(); }
    const current = new Set(ids);
    const added = new Set([...current].filter(id => !this.known.has(id)));
    this.known = current;
    return added;
  }
}
