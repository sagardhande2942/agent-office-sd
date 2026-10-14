/**
 * The desk toys: one on every place a coding agent sits — every desk, every bean bag, and every desk
 * in the back office.
 *
 * A toy takes no key of its own: the ray that lands on a toy lands on the desk it is standing on (see
 * toyAt), so a desk with a toy keeps every key it had, and the toy is found by aiming at it. What it
 * does then is its worker's news, which everyone on the floor already has in the store: a worker in
 * the middle of a turn idles its toy, a finished one sets it going, and one waiting on an answer
 * shivers — so from across the room you can see which desk needs you.
 *
 * Each toy hangs off its seat's own group, so it comes and goes with the seat: a back office row that
 * isn't built out yet, or a bean bag nobody needs yet, takes its toy with it.
 */

import type * as THREE from 'three';
import { BEANBAGS, DESKS, WING_DESKS, type DeskDef } from '../../../shared/layout';
import type { WorkerStatus } from '../../../shared/protocol';
import { isBusy } from '../../../shared/status';
import type { Fixture } from '../../world/office/fixture';
import { buildToy, deskToyKind, DESK_TOY_SPOT, LAP_TOY_SPOT, toyMotion, type ToyKind, type ToyMood, type ToySpot } from './toys';

/** One toy, on one seat. */
export interface SeatToy {
  /** The desk or bean bag it belongs to. */
  readonly deskId: string;
  /** Which of the three it is, which is what decides how it moves. */
  readonly kind: ToyKind;
  /** In its seat's own frame, so it stands and turns with the seat. */
  readonly group: THREE.Group;
  /** The part that turns: the top itself, the robot's key, the duck's body. */
  readonly spinner: THREE.Object3D;
  /** What its worker is up to, which the toy answers (see toyMood). installDeskToys keeps it current. */
  mood: ToyMood;
  /** Whether the floor is set to reduce motion, which takes the movement out but not the news. */
  calm: boolean;
  /** How hard it's wound up, 0 at rest, 1 the moment it's wound (a merge winds the whole floor up). */
  energy: number;
  /** The surface it stands on, which it bobs around rather than sinking into. */
  readonly restY: number;
}

/**
 * How long a wind-up lasts, and how much of one the office gives a floor: a merge winds every toy up
 * at once, and each one runs down from there whether or not anyone is watching.
 */
export const WIND_SECONDS = 2.6;
export const WIND_EACH = 0.34;

/**
 * How a worker's status reads on its desk's toy. Shared/status.ts already says what busy means, so
 * the moods are built on that rather than naming every status here.
 */
export function toyMood(status: WorkerStatus | undefined): ToyMood {
  if (!status) return 'idle';
  if (status === 'needs_input') return 'waiting';
  if (status === 'done') return 'done';
  // Anything else that's busy (booting, working) keeps its toy turning slowly.
  return isBusy(status) ? 'working' : 'idle';
}

/** Winds every toy on the floor up at once, the way a merge does. */
export function windToys(toys: ReadonlyMap<string, SeatToy>) {
  for (const toy of toys.values()) toy.energy = Math.min(1, toy.energy + WIND_EACH);
}

/** The toy for `def`, standing on `spot` in the seat's own frame. */
function toyAt(def: DeskDef, spot: ToySpot, index: number): SeatToy {
  const toy = buildToy(deskToyKind(index));
  toy.group.position.set(spot.t, spot.y, spot.s);
  // The toy is part of the desk as far as clicking is concerned, so it never takes a desk key away.
  toy.group.userData.interact = { kind: 'desk', deskId: def.id };
  return { deskId: def.id, kind: toy.kind, group: toy.group, spinner: toy.spinner, restY: spot.y, mood: 'idle', calm: false, energy: 0 };
}

declare module '../../world/types' {
  interface OfficeHandles {
    /** The toy on each seat, by desk id (see deskToys). */
    deskToys: ReadonlyMap<string, SeatToy>;
  }
}

/** The toys, on every seat of the office and of the back office, and on the bean bags round the room. */
export const deskToys: Fixture<'deskToys'> = (site) => {
  const toys = new Map<string, SeatToy>();
  const seats: { def: DeskDef; spot: ToySpot; turn?: number }[] = [
    ...DESKS.map((def) => ({ def, spot: DESK_TOY_SPOT })),
    ...WING_DESKS.map((def) => ({ def, spot: DESK_TOY_SPOT })),
    // A bean bag's laptop is on the lap desk in front of it (see buildBeanbag in world/office/seats.ts).
    // The bags get a turn of their own rather than carrying on from the desks: they are scattered
    // round the room rather than in pods, and two of them stand close enough to be neighbours, so
    // continuing the desks' turn ran the same toy onto that pair. Starting one seat along the pod
    // turn keeps every bean bag different from the bags around it.
    ...BEANBAGS.map((def) => ({ def, spot: LAP_TOY_SPOT, turn: 1 })),
  ];
  seats.forEach(({ def, spot, turn = 0 }, i) => {
    // A seat the floor hasn't built out yet is made by the wing, further down the plan: this lists it
    // either way, and the toy is only hung on once the desk it's standing on exists.
    const view = site.desks.get(def.id);
    if (!view) return;
    const toy = toyAt(def, spot, i + turn);
    view.group.add(toy.group);
    toys.set(def.id, toy);
  });
  return {
    handle: { deskToys: toys },
    /**
     * Winds each toy down and puts it where it should be. Every toy is a pure function of its own
     * wind-up, its worker's mood and the clock (toyMotion), so it is placed from scratch every frame
     * rather than stepped up from where it was: a frame that never ran — a background tab, a laptop
     * waking up — lands where the clock says instead of leaping.
     */
    update: (t, dt) => {
      for (const toy of toys.values()) {
        if (toy.energy > 0) toy.energy = Math.max(0, toy.energy - dt / WIND_SECONDS);
        const m = toyMotion(toy.kind, toy.energy, toy.mood, t, toy.calm);
        toy.group.rotation.set(m.tip, 0, m.lean);
        toy.group.position.y = toy.restY + m.bob;
        toy.spinner.rotation.y = m.turn;
      }
    },
  };
};