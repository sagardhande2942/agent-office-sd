/**
 * The people at the table, and the bats in their hands.
 *
 * A match used to have nobody on the far side of the net: just a bat hanging in mid air over the
 * table, with your own body hidden, so it looked like no one was playing. Each side now has a body
 * standing at its end of the table, and each bat hangs in its holder's hand and swings with them.
 */
import * as THREE from 'three';
import { facingTable, PINGPONG_SPOTS, type PingPongSide } from '../../../shared/tabletennis';
import { noOutline } from '../../core/outline';
import { Person } from '../../world/character';

/** How far a bat swings out as it is struck, and how high it comes (m). */
const SWING_OUT = 0.1;
const SWING_UP = 0.02;
/** How the worker bot at the far end is put together: one of each face, hair and outfit. */
const LOOK = { skin: 2, hair: 1, style: 0 };

/** Where a player stands at their end of the table, and which way they face it. */
export function standingSpot(side: PingPongSide): { x: number; z: number; rotY: number } {
  const spot = side === 'west' ? PINGPONG_SPOTS.west : PINGPONG_SPOTS.east;
  return { x: spot.x, z: spot.z, rotY: facingTable(spot.x, spot.z) };
}

/**
 * The body at the far end: the worker bot you are playing, or a stand-in for the other player while
 * their own body walks over to the table on their screen. It stands at its end, turns to the ball,
 * and swings when the ball is met.
 */
export class TableTennisOpponent {
  readonly person: Person;
  private swing = -1;

  constructor(scene: THREE.Scene, name: string, color: string, side: PingPongSide) {
    this.person = new Person(name, color, LOOK);
    this.person.setCostume(null);
    const at = standingSpot(side);
    this.person.root.position.set(at.x, 0, at.z);
    this.person.root.rotation.y = at.rotY;
    noOutline(this.person.root);
    scene.add(this.person.root);
  }

  /**
   * `progress` is the controller's swing, 0..π while it is under way and -1 when it is not; `at` is
   * where the other player is standing, which they walk about as they play.
   */
  update(dt: number, t: number, progress: number, at: { x: number; z: number }) {
    this.swing = progress;
    const pos = this.person.root.position;
    const dx = at.x - pos.x;
    const dz = at.z - pos.z;
    const moved = Math.hypot(dx, dz);
    pos.x += dx * Math.min(1, dt * 12);
    pos.z += dz * Math.min(1, dt * 12);
    this.person.update(dt, t, moved > 0.02, false, 1);
    const reach = Math.sin(Math.max(0, this.swing));
    const arm = this.person.rig.armR;
    arm.rotation.x = -0.7 - reach * 0.9;
    arm.rotation.z = -0.25 - reach * 0.35;
    this.person.root.rotation.y = facingTable(pos.x, pos.z);
  }

  get swinging() {
    return this.swing >= 0;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.person.root);
    this.person.root.traverse((o) => (o as THREE.Mesh).geometry?.dispose());
  }
}

/**
 * Both bats: the one in your hand and the one opposite, each placed from where its holder is
 * standing and swinging with them.
 */
export class TableTennisBats {
  private swing = -1;
  private oppSwing = -1;

  constructor(
    private readonly court: () => { group: THREE.Group; westPaddle: THREE.Group; eastPaddle: THREE.Group } | undefined,
    private readonly mineSide: PingPongSide,
  ) {}

  /**
   * `mine` and `theirs` are where the two bats are, in the world, in their holders' hands; swings are
   * 0..π while under way and -1 when not.
   */
  update(mine: { x: number; y: number; z: number }, theirs: { x: number; y: number; z: number } | undefined, swing: number, oppSwing: number) {
    this.swing = swing;
    this.oppSwing = oppSwing;
    const c = this.court();
    if (!c) return;
    const mineBat = this.mineSide === 'west' ? c.westPaddle : c.eastPaddle;
    const theirBat = this.mineSide === 'west' ? c.eastPaddle : c.westPaddle;
    place(mineBat, mine, swing, this.mineSide, c.group.position);
    if (theirs) place(theirBat, theirs, oppSwing, this.mineSide === 'west' ? 'east' : 'west', c.group.position);
  }
}

/** Puts a bat in its holder's hand, turned to face down the table, and swings it out. The bats are
 * children of the table, so a place in the room is measured from where the table stands. */
function place(bat: THREE.Group, at: { x: number; y: number; z: number }, swing: number, side: PingPongSide, table: THREE.Vector3) {
  const dir = side === 'west' ? 1 : -1;
  const reach = Math.sin(Math.max(0, swing));
  bat.position.set(at.x + dir * reach * SWING_OUT - table.x, at.y + reach * SWING_UP - table.y, at.z - table.z);
  bat.rotation.set(-0.9 - reach * 0.6, side === 'west' ? -Math.PI / 2 : Math.PI / 2, 0);
}