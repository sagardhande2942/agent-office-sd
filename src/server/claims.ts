import type { GhIssue } from '../shared/protocol.js';
export class Claims {
  /** By issue number: when GitHub had it assigned (Infinity until it answers). */
  private claimed = new Map<number, { at: number }>();

  /** A worker took issue `n`. Call what it returns once GitHub has answered, with whether it's assigned now. */
  take(n: number): (assigned: boolean, now?: number) => void {
    const claim = { at: Infinity };
    this.claimed.set(n, claim);
    return (assigned, now = Date.now()) => {
      if (assigned) claim.at = now;
      // Unless someone handed it over again meanwhile, and GitHub hasn't answered them yet.
      else if (this.claimed.get(n) === claim) this.claimed.delete(n);
    };
  }

  has(n: number): boolean {
    return this.claimed.has(n);
  }

  /**
   * `items` with the taken ones marked. A list asked for (`asked`) before an issue was assigned doesn't
   * have its assignee yet, so it stays marked over it; one asked for after is believed, and the claim forgotten.
   */
  mark(items: GhIssue[], asked = 0): GhIssue[] {
    for (const [n, claim] of this.claimed) if (claim.at < asked) this.claimed.delete(n);
    return items.map(({ taken, ...it }) => (this.claimed.has(it.number) ? { ...it, taken: true } : it));
  }
}
