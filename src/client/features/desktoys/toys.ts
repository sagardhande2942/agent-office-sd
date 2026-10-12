/**
 * The toys that sit on the coding agents' desks, and what each one does while it's going.
 *
 * Three kinds, and they take turns desk by desk, so no two neighbours match. Each is a handful of
 * primitives about desk-doll size (nothing here is over 15cm), with one part that turns and the
 * whole toy that leans, tips and bobs. So all three are driven by one small piece of arithmetic
 * (toyMotion) rather than three animations that drift apart.
 */

import * as THREE from 'three';
import { DESK_SIZE } from '../../../shared/layout';
import { mesh, toon } from '../../world/toon';

/** The toys there are, in the order the desks take turns with them. */
export const TOY_KINDS = ['top', 'duck', 'robot'] as const;
export type ToyKind = (typeof TOY_KINDS)[number];

/** The toy the `i`th desk gets: kinds take turns, so no two neighbours match. */
export function deskToyKind(i: number): ToyKind {
  return TOY_KINDS[((i % TOY_KINDS.length) + TOY_KINDS.length) % TOY_KINDS.length];
}

/** One toy: the group that goes in a desk's own frame, and the bit of it that turns. */
export interface Toy {
  kind: ToyKind;
  /** The whole toy, its origin on the desk under its middle. */
  group: THREE.Group;
  /** The part that turns about its own middle: the top, the duck, the robot's key. */
  spinner: THREE.Object3D;
  /** What the hint bar calls it. */
  name: string;
}

/** A spinning top, point down on the desk, with its coloured band and its little knob on top. */
function top(): Toy {
  const group = new THREE.Group();
  // Everything that turns, band and knob with it, or the top would come apart as it spun.
  const spinner = new THREE.Group();
  // The cone is built apex-up and flipped, so its point is the one on the desk, and it is centred
  // half its height up so that point is exactly at the surface rather than hovering over it.
  spinner.add(mesh(new THREE.ConeGeometry(0.062, 0.13, 20).rotateX(Math.PI), toon('#ef476f'), 0, 0.065, 0));
  spinner.add(mesh(new THREE.CylinderGeometry(0.05, 0.05, 0.012, 20), toon('#ffd166'), 0, 0.126, 0, false));
  spinner.add(mesh(new THREE.SphereGeometry(0.016, 10, 8), toon('#2b2d42'), 0, 0.14, 0, false));
  group.add(spinner);
  return { kind: 'top', group, spinner, name: '🌀 Spinning top' };
}

/** A rubber duck: a bean of a body, its head on the front of it, a bill and a tail. */
function duck(): Toy {
  const group = new THREE.Group();
  const spinner = new THREE.Group();
  const yellow = toon('#ffd166');
  // The body is a bean: wide, low and longer than it is tall, and sitting so its underside rests on
  // the surface (a 0.062 sphere scaled 0.9 in y is 0.0558 tall, so the centre is that far up).
  const round = mesh(new THREE.SphereGeometry(0.062, 16, 12), yellow, 0, 0.0558, 0);
  round.scale.set(1.25, 0.9, 1);
  spinner.add(round);
  spinner.add(mesh(new THREE.SphereGeometry(0.045, 14, 10), yellow, 0, 0.135, 0.03));
  // The bill, a little flattened cone pointing forward (+z), and an eye to each side.
  spinner.add(mesh(new THREE.ConeGeometry(0.019, 0.045, 10).rotateX(Math.PI / 2), toon('#ef8354'), 0, 0.128, 0.075, false));
  for (const sx of [-1, 1]) spinner.add(mesh(new THREE.SphereGeometry(0.008, 8, 6), toon('#2b2d42'), sx * 0.036, 0.148, 0.045, false));
  spinner.add(mesh(new THREE.ConeGeometry(0.022, 0.055, 8).rotateX(-0.9), yellow, 0, 0.09, -0.07, false));
  group.add(spinner);
  return { kind: 'duck', group, spinner, name: '🦆 Rubber duck' };
}

/** A wind-up robot: a barrel body, a square head with one lit eye, and the key on its back. */
function robot(): Toy {
  const group = new THREE.Group();
  group.add(mesh(new THREE.CylinderGeometry(0.05, 0.055, 0.1, 14), toon('#4cc9f0'), 0, 0.062, 0));
  group.add(mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.012, 14), toon('#8d99ae'), 0, 0.006, 0, false));
  const head = new THREE.Group();
  head.add(mesh(new THREE.BoxGeometry(0.085, 0.07, 0.075), toon('#e8f1f2'), 0, 0.032, 0));
  head.add(mesh(new THREE.SphereGeometry(0.018, 12, 10), toon('#ffd166', { emissive: '#f0a500' }), 0, 0.035, 0.042, false));
  head.position.y = 0.112;
  group.add(head);
  // The key on its back, the part that turns when the toy is wound.
  const spinner = new THREE.Group();
  spinner.add(mesh(new THREE.CylinderGeometry(0.005, 0.005, 0.06, 8).rotateX(Math.PI / 2), toon('#adb5bd'), 0, 0, 0, false));
  for (const sx of [-1, 1]) spinner.add(mesh(new THREE.TorusGeometry(0.016, 0.005, 6, 12), toon('#adb5bd'), sx * 0.026, 0, -0.03, false));
  spinner.position.set(0, 0.085, -0.055);
  group.add(spinner);
  return { kind: 'robot', group, spinner, name: '🤖 Wind-up robot' };
}

const BUILD: Record<ToyKind, () => Toy> = { top, duck, robot };

/** The toy of `kind`, built fresh (every desk has one of its own). */
export function buildToy(kind: ToyKind): Toy {
  return BUILD[kind]();
}

/**
 * Where a toy stands, in its seat's own frame: `t` across the desk (0 is its middle, +x is its
 * right as its worker faces it) and `s` from its middle, +z toward the worker.
 */
export interface ToySpot {
  t: number;
  s: number;
  /** How high the surface under it is. */
  y: number;
}

/**
 * On a desk: over on the left, in front of the knick-knack and within reach of the chair.
 *
 * The back corners already hold the desk's knick-knack (a mug, a succulent or the books, see
 * buildDesk in world/office/seats.ts) and the laptop is in the middle, so the toy goes on the left.
 * It stops short of the middle and well clear of the spot on the right where its worker gets up to
 * dance, and it sits toward the front of the desk so that the worker, who is at the middle of it,
 * can reach it without leaning right across the top.
 */
export const DESK_TOY_SPOT: ToySpot = { t: -0.62, s: 0.38, y: DESK_SIZE.height };

/** The same corner of a bean bag's lap desk, which is lower and a good deal smaller. */
export const LAP_TOY_SPOT: ToySpot = { t: -0.34, s: -0.8, y: 0.445 };

/**
 * What one toy is doing at `clock`, how hard it's wound up (`energy`, 0 at rest, 1 the moment it's
 * wound) and how its worker is getting on (`mood`).
 *
 * Written out rather than stepped up frame by frame, so that every toy on the floor is a pure
 * function of these four numbers with nothing carried in between: what a toy is doing at 12:01:30
 * depends only on how long it has been wound and what its worker is doing, so a frame that never
 * ran (a background tab, a laptop waking up) lands where the clock says instead of leaping.
 */
export interface ToyMotion {
  /** How far round the turning part has come, in radians. */
  turn: number;
  /** How far the toy has leaned over, in radians (about z, so left and right). */
  lean: number;
  /** How far it has tipped forward, in radians (about x). */
  tip: number;
  /** How far it has bobbed, in meters. */
  bob: number;
}

/** How a toy of each kind spends the same energy and mood. */
const TEMPO: Record<ToyKind, { spin: number; rock: number; pitch: number; bounce: number }> = {
  top: { spin: 26, rock: 0.035, pitch: 0.22, bounce: 0.016 },
  // A duck doesn't spin; it rocks, and it bobs when it quacks.
  duck: { spin: 0, rock: 0.11, pitch: 0.05, bounce: 0.03 },
  // The robot's key spins, and the body marches up and down the desk.
  robot: { spin: 9, rock: 0.05, pitch: 0.07, bounce: 0.026 },
};

/**
 * What one toy is doing right now. `mood` only adds to the wind-up, never takes from it: a toy on an
 * empty desk still spins when you wind it, it just has nothing of its own to do.
 */
export function toyMotion(kind: ToyKind, energy: number, mood: ToyMood, clock: number): ToyMotion {
  const tempo = TEMPO[kind];
  const e = Math.max(0, Math.min(1, energy));
  // A worker waiting on an answer is the one thing that reaches across the room, so its toy
  // shivers; one in the middle of a turn keeps its toy turning slowly, and one that has finished
  // sets it going.
  const shiver = mood === 'waiting' ? 1 : 0;
  const haste = mood === 'working' ? 1.4 : mood === 'done' ? 6 : 0;
  const spin = tempo.spin * e + haste;
  return {
    // A leaning top precesses the faster it turns, and every toy shivers while its worker waits.
    turn: spin * clock + Math.sin(clock * (2.2 + spin * 0.5)) * (0.035 * e + 0.09 * shiver),
    lean: Math.sin(clock * (2.2 + spin * 0.5)) * (tempo.rock * e + 0.07 * shiver + 0.0015),
    tip: Math.sin(clock * (3.1 + e * 6)) * (tempo.pitch * e + 0.004),
    bob: Math.sin(clock * (2.6 + e * 9)) * (tempo.bounce * e + 0.0015),
  };
}

/** What the coding agent at a desk is doing, which its toy answers. */
export type ToyMood = 'working' | 'waiting' | 'done' | 'idle';