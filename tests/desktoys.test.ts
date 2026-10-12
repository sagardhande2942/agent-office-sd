import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Group, Object3D, Vector3 } from 'three';
import { BEANBAGS, DESKS, DESK_SIZE, WING_DESKS, type DeskDef } from '../src/shared/layout.js';
import { deskToys, toyMood, windToys, WIND_EACH, WIND_SECONDS, type SeatToy } from '../src/client/features/desktoys/world.js';
import { buildToy, deskToyKind, DESK_TOY_SPOT, LAP_TOY_SPOT, TOY_KINDS, toyMotion } from '../src/client/features/desktoys/toys.js';
import { toonUnique } from '../src/client/world/toon.js';
import type { Site } from '../src/client/world/office/fixture.js';

// The desk toys: what each of the three is made of, that every seat a coding agent sits at has one,
// that a seat nobody has built yet takes no toy, that a toy never swallows its desk's own interactable
// (it hangs off the desk's kind, so the desk keeps every key it had), and what a toy does as its
// worker changes. The office is built in a browser, so it's the real builders and the real fixture
// that are measured here, in Node.

/** The lowest and highest point of `root` in its own frame, its position taken out. */
function bounds(root: Object3D) {
  root.updateMatrixWorld(true);
  const b = new Box3().setFromObject(root);
  return { min: b.min.clone(), max: b.max.clone(), size: b.getSize(new Vector3()) };
}

/** Just enough of a Site for the fixture: the desks, and nothing else it asks for. */
function site(desks: readonly DeskDef[]) {
  const views = new Map<string, { group: Group }>();
  for (const def of desks) views.set(def.id, { group: new Group() });
  const built = deskToys({
    group: new Group(),
    colliders: [],
    interactables: [],
    wall: () => {},
    looks: { wall: toonUnique('#fff'), trim: toonUnique('#fff'), planks: [] },
    planks: toonUnique('#fff'),
    desks: views,
    doors: [],
    inTheWay: [],
    get: (key) => {
      throw new Error(`the toys asked for ${String(key)}, which this site hasn't built`);
    },
  } as unknown as Site);
  assert.ok(built.update, 'the toys are moved each frame');
  const toys = built.handle!.deskToys;
  return { toys, frame: built.update!, view: (id: string) => views.get(id)!.group };
}

test('each of the three toys stands on what it is put on, and fits in a desk corner', () => {
  for (const kind of TOY_KINDS) {
    const { min, size } = bounds(buildToy(kind).group);
    // It stands on the surface: nothing floating above it, nothing sunk into it.
    assert.ok(Math.abs(min.y) < 0.002, `${kind} doesn't stand on the surface (its lowest point is ${min.y.toFixed(4)})`);
    // Desk-doll sized, so it leaves the desk room: a desk is 2.2 by 1.1 and the toy's spot is a corner.
    assert.ok(size.x < 0.25 && size.z < 0.25, `${kind} is ${size.x.toFixed(2)} by ${size.z.toFixed(2)}, too big for a desk corner`);
    assert.ok(size.y < 0.25, `${kind} is ${size.y.toFixed(2)} tall, too tall for a desk toy`);
    // And it can't take more than a fifth of the desk's depth, so the laptop still has room.
    assert.ok(size.z < DESK_SIZE.depth / 5, `${kind} takes too much of the desk's depth`);
  }
});

test('every toy has a part of its own that turns, or it is not a toy', () => {
  for (const kind of TOY_KINDS) {
    const toy = buildToy(kind);
    assert.ok(toy.spinner, `${kind} has nothing that turns`);
    // The part that turns hangs under the toy, so it turns with the desk.
    let parent: Object3D | null = toy.spinner;
    while (parent && parent !== toy.group) parent = parent.parent;
    assert.equal(parent, toy.group, `${kind}'s turning part is not part of the toy`);
  }
});

test('the kinds take turns desk by desk, so no two neighbours match', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5].map(deskToyKind), ['top', 'duck', 'robot', 'top', 'duck', 'robot']);
  // Whatever index it is handed, it names one of the three.
  for (const i of [-4, -1, 0, 1, 2, 7, 15, 16, 31, 32, 999]) assert.ok(TOY_KINDS.includes(deskToyKind(i)));

  // Built in order, consecutive seats never match.
  const { toys } = site([...DESKS, ...WING_DESKS, ...BEANBAGS]);
  const kinds = [...toys.values()].map((t) => t.kind);
  for (let i = 1; i < kinds.length; i++) assert.notEqual(kinds[i], kinds[i - 1], `seats ${i - 1} and ${i} both have a ${kinds[i]}`);
});

test('every seat a coding agent sits at gets a toy: the desks, the back office and the bean bags', () => {
  const seats = [...DESKS, ...WING_DESKS, ...BEANBAGS];
  const { toys } = site(seats);
  for (const def of seats) assert.ok(toys.has(def.id), `${def.id} has no toy`);
  assert.equal(toys.size, seats.length);
});

test('a desk toy stands on its desk top in the back corner, and a bean bag toy on the lap desk', () => {
  const { toys } = site([DESKS[0], BEANBAGS[0]]);
  const deskToy = toys.get(DESKS[0].id)!;
  assert.equal(deskToy.restY, DESK_SIZE.height, "it stands on the desk top");
  assert.equal(deskToy.group.position.x, DESK_TOY_SPOT.t);
  assert.equal(deskToy.group.position.z, DESK_TOY_SPOT.s);
  // On the desk, clear of the laptop in the middle, and clear of the knick-knack in the back corners.
  assert.ok(DESK_TOY_SPOT.t < -DESK_SIZE.width / 4, 'it is over on the left');
  assert.ok(Math.abs(DESK_TOY_SPOT.t) > Math.abs(DESK_TOY_SPOT.s), 'and in the corner, not the middle');
  assert.ok(DESK_TOY_SPOT.s > -DESK_SIZE.depth / 2 && DESK_TOY_SPOT.s < DESK_SIZE.depth / 2, 'and still on the desk');
  // And nothing already on the desk is standing where it stands.
  for (const [x, z] of [
    [DESK_SIZE.width / 2 - 0.25, -0.2],
    [-DESK_SIZE.width / 2 + 0.25, -0.25],
    [DESK_SIZE.width / 2 - 0.26, -0.3],
  ]) {
    assert.ok(Math.hypot(x - DESK_TOY_SPOT.t, z - DESK_TOY_SPOT.s) > 0.15, `it lands on the knick-knack at ${x}, ${z}`);
  }

  const bagToy = toys.get(BEANBAGS[0].id)!;
  assert.equal(bagToy.restY, LAP_TOY_SPOT.y);
  assert.ok(bagToy.restY < DESK_SIZE.height, 'a bean bag toy is down on the lap desk, not up at desk height');
});

test('a toy hangs off its own desk, so it comes and goes with it', () => {
  const desk = DESKS[0];
  const { toys, view } = site([desk]);
  const toy = toys.get(desk.id)!;
  assert.ok(view(desk.id).children.includes(toy.group), 'the toy is part of the desk group');
});

test("a toy's interactable is its own desk's, so the toy never swallows a desk key", () => {
  const desk = DESKS[0];
  const { toys } = site([desk]);
  const it = toys.get(desk.id)!.group.userData.interact as { kind: string; deskId: string };
  assert.equal(it.kind, 'desk');
  assert.equal(it.deskId, desk.id);
});

test('a seat the floor has not built out gets no toy, so none hangs in the air', () => {
  const { toys } = site([DESKS[0]]);
  assert.ok(toys.has(DESKS[0].id));
  for (const def of WING_DESKS) assert.ok(!toys.has(def.id), `${def.id} has a toy but no desk`);

  // Built out, the back office's desks get theirs.
  const built = site([...DESKS, ...WING_DESKS]);
  for (const def of WING_DESKS) assert.ok(built.toys.has(def.id));
});

test("a worker's status reads on its toy, and only a waiting one is worth shaking", () => {
  assert.equal(toyMood(undefined), 'idle', 'an empty desk');
  assert.equal(toyMood('idle'), 'idle', 'a worker with no first prompt');
  assert.equal(toyMood('offline'), 'idle');
  assert.equal(toyMood('exited'), 'idle');
  assert.equal(toyMood('starting'), 'working', 'booting is still a turn in the middle of');
  assert.equal(toyMood('working'), 'working');
  assert.equal(toyMood('needs_input'), 'waiting');
  assert.equal(toyMood('done'), 'done');

  const at = (mood: Parameters<typeof toyMotion>[2]) => toyMotion('top', 0, mood, 1.7);
  assert.ok(Math.abs(at('waiting').lean) > Math.abs(at('working').lean), 'waiting shakes its toy harder than working');
  assert.ok(Math.abs(at('working').lean) > Math.abs(at('idle').lean), 'working rocks a toy that idle leaves still');
  assert.ok(Math.abs(at('done').turn) > Math.abs(at('working').turn), 'a finished worker sets its toy going');
  // A toy on an empty desk is quiet: it's not working, and it isn't showing anybody anything.
  for (const channel of ['lean', 'tip', 'bob'] as const) assert.ok(Math.abs(at('idle')[channel]) < 0.01, `an idle toy moves its ${channel}`);
});

test('every toy is a plain function of its wind-up, its mood and the clock', () => {
  const { toys, frame } = site([DESKS[0]]);
  const toy: SeatToy = toys.get(DESKS[0].id)!;
  toy.mood = 'working';
  // Whatever happened before the frame, where the toy ends up is only what these three say.
  for (const clock of [0, 1.7, 12.5, 900.25]) {
    toy.energy = 0.5;
    frame(clock, 0);
    const want = toyMotion(toy.kind, 0.5, 'working', clock);
    assert.equal(toy.spinner.rotation.y, want.turn, `the turn at ${clock}`);
    assert.equal(toy.group.rotation.z, want.lean, `the lean at ${clock}`);
    assert.equal(toy.group.rotation.x, want.tip, `the tip at ${clock}`);
    assert.ok(Math.abs(toy.group.position.y - (toy.restY + want.bob)) < 1e-9, `the bob at ${clock}`);
  }
  // So a frame that never ran lands where the clock says, rather than leaping or standing still.
  toy.energy = 0;
  frame(300, 0);
  const quiet = toy.spinner.rotation.y;
  toy.energy = 0;
  frame(300, 0);
  assert.equal(toy.spinner.rotation.y, quiet, 'the same clock puts the toy in the same place');
});

test('a wind-up runs out on its own, never goes past full, and leaves the toy standing', () => {
  const { toys, frame } = site([DESKS[0]]);
  const toy = toys.get(DESKS[0].id)!;
  for (let i = 0; i < 10; i++) windToys(toys);
  assert.equal(toy.energy, 1, 'it is full, not over');

  // A full wind lasts about WIND_SECONDS, then the toy is back where it started.
  frame(1, WIND_SECONDS / 2);
  assert.ok(Math.abs(toy.energy - 0.5) < 1e-9, `half a wind later it is at ${toy.energy}`);
  frame(2, WIND_SECONDS);
  assert.equal(toy.energy, 0, 'and it runs out rather than going negative');
  frame(3, WIND_SECONDS);
  assert.equal(toy.energy, 0);

  // Wherever it is in its wind-up, it is still standing on the desk it was put on.
  for (const energy of [0, 0.25, 0.5, 1]) {
    toy.energy = energy;
    frame(4, 0);
    assert.ok(Math.abs(toy.group.position.y - toy.restY) < 0.05, `a toy wound to ${energy} lifted off the desk`);
  }
});

test('with reduce motion on a toy holds one fixed pose, and still says its worker is waiting', () => {
  const { toys, frame } = site([DESKS[0]]);
  const toy = toys.get(DESKS[0].id)!;
  toy.calm = true;
  toy.mood = 'waiting';
  toy.energy = 1;

  // It stands still wherever the frame falls: nothing turns, rocks, tips or bobs.
  for (const clock of [0, 1.7, 12.5, 900.25]) {
    frame(clock, 1 / 60);
    assert.equal(toy.spinner.rotation.y, 0, `it turned at ${clock}`);
    assert.equal(toy.group.rotation.x, 0, `it tipped at ${clock}`);
    assert.equal(toy.group.position.y, toy.restY, `it bobbed at ${clock}`);
    assert.equal(toy.group.rotation.z, toyMotion('top', 1, 'waiting', clock, true).lean);
  }
  // And the pose is not a shrug: a worker waiting on an answer still has its toy leaning over.
  assert.ok(Math.abs(toy.group.rotation.z) > 0.05, 'a waiting toy no longer leans over with motion off');

  // A worker that isn't waiting stands it up, rather than leaving it at somebody else's lean.
  toy.mood = 'working';
  frame(4, 1 / 60);
  assert.equal(toy.group.rotation.z, 0, 'a working toy leans over with motion off');
  assert.equal(toy.group.position.y, toy.restY, 'and it does not bob');

  // Turning it back off brings the movement straight back.
  toy.calm = false;
  frame(4, 1 / 60);
  assert.notEqual(toy.group.rotation.z, 0);
});

test('a wind gives every toy the same wind-up, so a merge sets the whole floor off together', () => {
  const { toys } = site([...DESKS, ...BEANBAGS]);
  windToys(toys);
  for (const [id, toy] of toys) assert.equal(toy.energy, WIND_EACH, `${id} didn't get the wind-up`);
});