
import { FLOOR, WING, PLANTS, GreenKind, GREEN_KINDS, GREEN_PLANTS, STREET_Y, STOREY, SeatDef, SEATING_BY_ID, SeatPlace, ELEVATOR, ELEVATOR_CAR } from './layout.js';


/** A plant by the north wall east of the gong, in the way into the back office: put away once it's built. */
export function plantByWing([x, z]: readonly [number, number, number]): boolean {
  return x > WING.minX && z < FLOOR.minZ + 1.5;
}


/** The plants standing on a floor built out `level` rows (see WING). */
export function plantsAt(level: number): readonly (readonly [x: number, z: number, scale: number])[] {
  return level > 0 ? PLANTS.filter((p) => !plantByWing(p)) : PLANTS;
}


/** The code-built species for the `i`th of a row of them (see GREEN_PLANTS). */
export function greenPlantKind(i: number): GreenKind {
  return GREEN_KINDS[i % GREEN_KINDS.length];
}


/** How far below floor `index` of the building (0 is the bottom one) the street is. */
export function streetBelow(index: number): number {
  return STREET_Y - Math.max(0, index) * STOREY;
}


// ---- The rooftop bar (see shared/rooftop.ts) ------------------------------------------------------
// The roof of the building, level with the office floor's y = 0 and the same size, so the elevator
// comes up in its usual spot. A glass railing runs round the edge, and the city is far below.

/**
 * How far below the roof the street is, with `floors` floors under it: the building is this tall.
 * The roof stands a STOREY over the top floor, where a floor above it would be.
 */
export function roofDrop(floors: number): number {
  return -streetBelow(Math.max(1, floors));
}


export function seatPlace(seat: SeatDef, i: number): SeatPlace {
  const fx = Math.sin(seat.rotY);
  const fz = Math.cos(seat.rotY);
  const along = seat.places[i] ?? 0;
  return {
    key: `${seat.id}:${i}`,
    seatId: seat.id,
    x: seat.x + fx * seat.depth + fz * along,
    y: seat.y,
    z: seat.z + fz * seat.depth - fx * along,
    rotY: seat.rotY,
    hips: seat.hips,
    out: seat.out,
  };
}


/** The place a peer's `seat` names, or undefined if there's no such place. */
export function seatAt(key: string): SeatPlace | undefined {
  const m = /^([\w-]+):(\d+)$/.exec(key);
  const seat = m ? SEATING_BY_ID.get(m[1]) : undefined;
  const i = Number(m?.[2]);
  return seat && i < seat.places.length ? seatPlace(seat, i) : undefined;
}


/** The place `key` names, if it's somewhere you can sit from where you are: up on the roof, or down on a floor. */
export function seatHere(key: string, onRoof: boolean): SeatPlace | undefined {
  const place = seatAt(key);
  return place && !!SEATING_BY_ID.get(place.seatId)!.roof === onRoof ? place : undefined;
}


/** Somewhere inside the car, facing the doors (+z), a little apart from anyone else arriving. */
export function elevatorSpot(): { x: number; z: number } {
  return {
    x: ELEVATOR.x + (Math.random() - 0.5) * 0.7,
    z: (ELEVATOR_CAR.minZ + ELEVATOR_CAR.maxZ) / 2 + (Math.random() - 0.5) * 0.6,
  };
}


export function inElevator(x: number, z: number): boolean {
  return x > ELEVATOR_CAR.minX && x < ELEVATOR_CAR.maxX && z > ELEVATOR_CAR.minZ && z < ELEVATOR_CAR.maxZ;
}
