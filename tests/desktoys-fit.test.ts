import test from 'node:test';
import assert from 'node:assert/strict';
import { Box3, Object3D, Vector3 } from 'three';
import { DESK_SIZE } from '../src/shared/layout.js';
import { buildDesk } from '../src/client/world/office/seats.js';
import { PALETTE } from '../src/client/world/office/materials.js';
import { toonUnique } from '../src/client/world/toon.js';
import { buildToy, DESK_TOY_SPOT, TOY_KINDS } from '../src/client/features/desktoys/toys.js';

// Does a toy actually fit on a real desk, rather than on the plan of one? buildDesk is run for each
// of the three decorations (a mug, a succulent, books take turns) and each of the three toys, and the
// toy's box is checked against everything already on the desk: the laptop anchor in the middle, the
// knick-knack in the back corner, the modesty panel, and the spot on the right the worker dances on.

/** A box in the desk's own frame, from `root` at `x`, `z` and `y` on the desk top. */
function boxAt(root: Object3D, x: number, y: number, z: number): Box3 {
  const g = root.clone(true);
  g.position.set(x, y, z);
  g.updateMatrixWorld(true);
  return new Box3().setFromObject(g);
}

/** Anything in `parent` whose own box comes within `clear` of `toy`. */
function clashes(parent: Object3D, toy: Box3, clear: number): string[] {
  const out: string[] = [];
  parent.traverse((o) => {
    const m = o as Object3D & { isMesh?: boolean; geometry?: unknown };
    if (!m.isMesh) return;
    o.updateMatrixWorld(true);
    const b = new Box3().setFromObject(o);
    if (b.isEmpty()) return;
    b.expandByScalar(-clear);
    if (b.intersectsBox(toy)) out.push(o.name || o.geometry?.constructor.name || 'mesh');
  });
  return out;
}

test('a toy on a real desk touches nothing already on it: not the laptop, the knick-knack or the dance spot', () => {
  // The dance spot (stage), which is where the worker climbs up on a merge, is a bare anchor.
  const STAGE = { x: 0.72, z: 0.18, y: DESK_SIZE.height - 0.07 };
  // The laptop in the middle, as a box around its 1.3-scaled anchor (a laptop is roughly 0.35 wide).
  const LAPTOP = { x: 0, z: -0.06, y: DESK_SIZE.height, w: 0.5, d: 0.4, h: 0.25 };
  let checked = 0;
  for (const kind of TOY_KINDS) {
    const toyBox = boxAt(buildToy(kind).group, DESK_TOY_SPOT.t, DESK_TOY_SPOT.y, DESK_TOY_SPOT.s);
    for (let deco = 0; deco < 3; deco++) {
      // Build a real desk with this decoration. buildDesk adds a mug / succulent / books by index % 3,
      // and index only picks the deco, so pass an index with that remainder.
      const desk = buildDesk({ id: 'd', x: 0, z: 0, rotY: 0, label: 'Desk' }, deco, toonUnique(PALETTE.wallTrim));
      const inDesk = (obj: Object3D) => {
        obj.updateMatrixWorld(true);
        return new Box3().setFromObject(obj);
      };
      // The laptop anchor is empty here (a worker isn't hired), so box it by hand at its own place.
      const laptop = new Box3(
        new Vector3(LAPTOP.x - LAPTOP.w / 2, LAPTOP.y, LAPTOP.z - LAPTOP.d / 2),
        new Vector3(LAPTOP.x + LAPTOP.w / 2, LAPTOP.y + LAPTOP.h, LAPTOP.z + LAPTOP.d / 2),
      );
      const stage = new Box3(
        new Vector3(STAGE.x - 0.3, STAGE.y, STAGE.z - 0.3),
        new Vector3(STAGE.x + 0.3, STAGE.y + 0.9, STAGE.z + 0.3),
      );
      // Everything on the desk is real geometry except the (empty) laptop and the (bare) stage anchor.
      const realClashes = clashes(desk.group, toyBox, 0.005).filter((name) => name !== 'laptopAnchor' && name !== 'stage');
      assert.deepEqual(realClashes, [], `${kind} on deco ${deco} clashes with ${realClashes.join(', ')}`);
      assert.ok(!toyBox.intersectsBox(laptop), `${kind} on deco ${deco} is inside the laptop`);
      assert.ok(!toyBox.intersectsBox(stage), `${kind} on deco ${deco} is where the worker dances`);
      checked++;
    }
  }
  assert.equal(checked, 9, 'every toy against every decoration');
});

test('the toy sits on the desk top, within reach of the chair, and does not hang off the desk', () => {
  const toy = boxAt(buildToy('robot').group, DESK_TOY_SPOT.t, DESK_TOY_SPOT.y, DESK_TOY_SPOT.s);
  // On the desk: inside its top's bounds, all round.
  assert.ok(toy.min.x > -DESK_SIZE.width / 2 && toy.max.x < DESK_SIZE.width / 2, 'it hangs off the side');
  assert.ok(toy.min.z > -DESK_SIZE.depth / 2 && toy.max.z < DESK_SIZE.depth / 2, 'it hangs off the front or back');
  // On the top: its bottom is the desk height, because every builder stands its toy at y=0.
  assert.ok(Math.abs(toy.min.y - DESK_SIZE.height) < 0.005, 'it is not resting on the desk top');
  // Within an arm's reach of where the worker sits: the middle of the desk's front edge.
  const reach = Math.hypot(DESK_TOY_SPOT.t, DESK_TOY_SPOT.s - DESK_SIZE.depth / 2);
  assert.ok(reach < 0.7, `the toy is ${reach.toFixed(2)} from the worker, out of arm's reach`);
  // And clear of the chair, which stands off the front of the desk under its middle.
  assert.ok(DESK_TOY_SPOT.s < DESK_SIZE.depth / 2, 'the toy is over the edge the chair sits under');
});