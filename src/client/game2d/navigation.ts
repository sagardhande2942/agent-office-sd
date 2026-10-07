import type { NavGrid, Pt } from '../../shared/nav';

/** Grid boundaries belong to the destination cell; DDA must stop just before the endpoint
 * to avoid stepping past it when travelling in the negative direction. Both endpoints
 * still have to be walkable, and the grid checks every intervening corner. */
export function segmentClear(nav: NavGrid, a: Pt, b: Pt): boolean {
  if (!nav.walkable(...a) || !nav.walkable(...b)) return false;
  return nav.clearLine(a, [b[0] + (a[0] - b[0]) * 1e-8, b[1] + (a[1] - b[1]) * 1e-8]);
}

/** Continuous movement checked against every crossed navigation cell. */
export class Walker {
  path: Pt[] = [];
  facing = 0;
  moving = false;
  constructor(public nav: NavGrid, public at: Pt) { this.at = nav.nearestWalkable(at); }
  stop() { this.path = []; this.moving = false; }
  walk(to: Pt): boolean {
    const path = this.nav.route(this.at, to);
    // NavGrid's disconnected fallback is a direct segment; reject it explicitly.
    if (!path.every((p, i) => this.nav.walkable(...p) && (!i || segmentClear(this.nav, path[i - 1], p)))) { this.stop(); return false; }
    this.path = path.slice(1);
    return true;
  }
  tick(dt: number, dx = 0, dz = 0) {
    const before: Pt = [...this.at];
    dt = Math.max(0, Math.min(0.1, dt));
    if (dx || dz) {
      this.path = [];
      const length = Math.hypot(dx, dz);
      dx /= length; dz /= length;
      const steps = Math.max(1, Math.ceil(dt * 5 / 0.1));
      for (let i = 0; i < steps; i++) this.slide(dx * 5 * dt / steps, dz * 5 * dt / steps);
    } else {
      let budget = 5 * dt;
      while (this.path.length && budget > 0) {
        const goal = this.path[0], distance = Math.hypot(goal[0] - this.at[0], goal[1] - this.at[1]);
        if (!segmentClear(this.nav, this.at, goal) || !this.nav.walkable(...goal)) { this.stop(); break; }
        if (distance <= budget) { this.at = [...goal]; this.path.shift(); budget -= distance; }
        else { this.at = [this.at[0] + (goal[0] - this.at[0]) * budget / distance, this.at[1] + (goal[1] - this.at[1]) * budget / distance]; budget = 0; }
      }
    }
    this.moving = Math.hypot(this.at[0] - before[0], this.at[1] - before[1]) > 0.0001;
    if (this.moving) this.facing = Math.atan2(this.at[0] - before[0], this.at[1] - before[1]);
  }
  private slide(dx: number, dz: number) {
    const move = (p: Pt) => {
      if (!this.nav.walkable(...p) || !segmentClear(this.nav, this.at, p)) return false;
      this.at = p; return true;
    };
    if (move([this.at[0] + dx, this.at[1] + dz])) return;
    move([this.at[0] + dx, this.at[1]]);
    move([this.at[0], this.at[1] + dz]);
  }
}
