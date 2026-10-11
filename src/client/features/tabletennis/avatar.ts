/** The bats at the table, positioned independently of avatar bodies. */
import * as THREE from 'three';
import { facingTable, PINGPONG_SPOTS, type PingPongSide } from '../../../shared/tabletennis';

/** How far a bat swings out as it is struck, and how high it comes (m). */
const SWING_OUT = 0.1;
const SWING_UP = 0.02;
/** Where a player stands at their end of the table, and which way they face it. */
export function standingSpot(side: PingPongSide): { x: number; z: number; rotY: number } {
  const spot = side === 'west' ? PINGPONG_SPOTS.west : PINGPONG_SPOTS.east;
  return { x: spot.x, z: spot.z, rotY: facingTable(spot.x, spot.z) };
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