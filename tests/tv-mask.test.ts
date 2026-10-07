import test, { type TestContext } from 'node:test';
import assert from 'node:assert/strict';
import { Mesh, MeshBasicMaterial, PerspectiveCamera, PlaneGeometry, Vector3 } from 'three';
import type { Collider } from '../src/client/world/types.js';
import { blocks } from '../src/client/tv-projection.js';
import { cullBodies, fillMask, maskGrid } from '../src/client/tv-mask.js';

// The TV's picture is ordinary HTML over the canvas, so it can't be depth-tested against the scene
// and the office has to work out for itself what stands in front of it: the occlusion mask in
// tv-mask.ts, which is the one hot loop while a link plays — every cell of the picture, against
// everything that could reach it, a dozen times a second. These pin what it has to keep saying.

/**
 * The slab test answered the long way round with arrays, which is what it used to be: the walk
 * tv-projection.ts now writes out by hand has to agree with it on every branch.
 */
function reference(eye: Vector3, to: Vector3, c: Collider): boolean {
  const from = [eye.x, eye.y, eye.z];
  const delta = [to.x - eye.x, to.y - eye.y, to.z - eye.z];
  const low = [c.minX, c.bottom ?? 0, c.minZ];
  const high = [c.maxX, c.top, c.maxZ];
  let t0 = 0;
  let t1 = 1;
  for (let i = 0; i < 3; i++) {
    if (Math.abs(delta[i]) < 1e-9) {
      if (from[i] < low[i] || from[i] > high[i]) return false;
      continue;
    }
    let a = (low[i] - from[i]) / delta[i];
    let b = (high[i] - from[i]) / delta[i];
    if (a > b) [a, b] = [b, a];
    t0 = Math.max(t0, a);
    t1 = Math.min(t1, b);
    if (t0 > t1) return false;
  }
  return true;
}

test('the slab test says what the long way round says, on every branch', () => {
  let seed = 12345;
  const random = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const boxes: Collider[] = [];
  for (let i = 0; i < 200; i++) {
    const x = random() * 20 - 10;
    const y = random() * 4;
    const z = random() * 20 - 10;
    boxes.push({ minX: x, maxX: x + random() * 4, minZ: z, maxZ: z + random() * 4, bottom: y, top: y + random() * 3 });
  }
  let hits = 0;
  let asked = 0;
  for (let i = 0; i < 4000; i++) {
    const eye = new Vector3(random() * 30 - 15, random() * 3, random() * 30 - 15);
    const to = new Vector3(random() * 30 - 15, random() * 3, random() * 30 - 15);
    // A fifth of the rays lie dead flat on one axis: the branch that can't be divided by.
    if (i % 5 === 0) {
      const axis = (['x', 'y', 'z'] as const)[i % 3];
      to[axis] = eye[axis];
    }
    for (const c of boxes) {
      const want = reference(eye, to, c);
      assert.equal(blocks(eye, to, c), want, `${eye.toArray()} → ${to.toArray()} against ${JSON.stringify(c)}`);
      asked++;
      hits += want ? 1 : 0;
    }
  }
  assert.ok(hits > 1000, `only ${hits} of ${asked} rays hit anything, so this proved little`);
});

test('a box fattened by a metre is a box with a metre more of it', () => {
  const eye = new Vector3(0, 1.6, 0);
  const to = new Vector3(10, 1.6, 0);
  const desk: Collider = { minX: 6, maxX: 7, minZ: -0.5, maxZ: 0.5, bottom: 0, top: 0.8 };
  assert.equal(blocks(eye, to, desk), false);
  assert.equal(blocks(eye, to, { ...desk, maxZ: -0.9 }, 1), true);
  assert.equal(blocks(eye, to, { ...desk, maxZ: -1.1 }, 1), false);
});

/** The TV's own screen: 6.4 m of picture on the east wall of the lounge. */
function tvScreen(w = 6.4, h = 3.6) {
  const mesh = new Mesh(new PlaneGeometry(w, h), new MeshBasicMaterial());
  mesh.position.set(14, 2.4, 0);
  mesh.updateMatrixWorld(true);
  return mesh;
}

test('the picture is cut into cells that lie where the screen does', () => {
  const grid = maskGrid(tvScreen());
  assert.equal(grid.points.length, grid.width * grid.height * 3);
  const at = (col: number, row: number) =>
    new Vector3(grid.points[(row * grid.width + col) * 3], grid.points[(row * grid.width + col) * 3 + 1], grid.points[(row * grid.width + col) * 3 + 2]);
  assert.ok(at(grid.width / 2, grid.height / 2).distanceTo(new Vector3(14, 2.4, 0)) < 0.05);
  // Row 0 is the top of the picture, because the mask is stretched over the frame as it is.
  assert.ok(at(0, 0).y > at(0, grid.height - 1).y);
  // And how far the picture spreads either side of its middle is half its own diagonal.
  assert.ok(Math.abs(grid.radius - Math.hypot(6.4, 3.6) / 2) < 1e-5, `${grid.radius}`);
});

test('what stands in the way hides its own part of the picture and no other', () => {
  const grid = maskGrid(tvScreen());
  const eye = new Vector3(14, 2.4, -10);
  /** The cells hidden, as the band of columns and rows they run through. */
  const hiddenAt = () => {
    const cols: number[] = [];
    const rows = new Set<number>();
    for (let row = 0; row < grid.height; row++)
      for (let col = 0; col < grid.width; col++)
        if (grid.alpha[row * grid.width + col] === 0) {
          cols.push(col);
          rows.add(row);
        }
    return { cols: [Math.min(...cols), Math.max(...cols)], rows: [...rows] };
  };
  // Nothing in the way: the whole picture shows.
  assert.equal(fillMask(grid, eye, [], [], null), 0);
  assert.ok([...grid.alpha].every(a => a === 255));
  // A person standing dead in front of it, taller than the picture: the middle of it goes, and only
  // the middle — from ten metres away a person is a person-sized slice of a six-metre screen.
  const person: Collider = { minX: 13.6, maxX: 14.4, minZ: -5, maxZ: -4, bottom: 0, top: 4 };
  const hidden = fillMask(grid, eye, [person], [], null);
  const band = hiddenAt();
  assert.ok(hidden > 0 && hidden < grid.width * grid.height * 0.5, `${hidden} of ${grid.width * grid.height} cells hidden`);
  assert.ok(band.cols[0] > grid.width * 0.2 && band.cols[1] < grid.width * 0.8, `columns ${band.cols.join('..')} of ${grid.width}`);
  assert.deepEqual(band.rows.length > grid.height * 0.9 ? [0, grid.height - 1] : band.rows, [0, grid.height - 1]);
  // A bench across the bottom of it hides the bottom rows, and nothing above them.
  grid.alpha.fill(255);
  const bench: Collider = { minX: 12, maxX: 16, minZ: -3, maxZ: -2, bottom: 0, top: 1.4 };
  const rows = fillMask(grid, eye, [bench], [], null);
  assert.ok(rows > 0 && rows < grid.width * grid.height * 0.2, `${rows} cells hidden by the bench`);
  const low = hiddenAt();
  assert.ok(low.rows.every(row => row > grid.height * 0.5), `only the bottom rows should be hidden: ${low.rows.join(',')}`);
  // Your own hands over part of the picture count as being in the way (see TvSiting.handCover).
  grid.alpha.fill(255);
  assert.equal(fillMask(grid, eye, [], [], (u) => u > 0.5), (grid.width * grid.height) / 2);
});

test('people who could not be in front of the picture are not asked about', () => {
  const grid = maskGrid(tvScreen());
  const eye = new Vector3(10, 1.6, -6);
  const person = (x: number, z: number): Collider => ({ minX: x - 0.35, maxX: x + 0.35, minZ: z - 0.35, maxZ: z + 0.35, bottom: 0, top: 1.8 });
  const kept = cullBodies([person(12, -3), person(14, -3), person(-20, 12), person(30, -2)], eye, grid.centre, grid.radius);
  assert.deepEqual(
    kept.map(b => [b.minX + 0.35, b.minZ + 0.35]),
    [
      [12, -3],
      [14, -3],
    ],
    'the two by the screen are kept; the ones across the office, off to either side, are dropped',
  );
});

// ---- The picture on the wall (tv-siting.ts) ------------------------------------------------------
// A mask is dear: the browser has to repaint the whole picture under it every time it changes, and a
// masked layer can't be composited straight off the video. So the frame wears one only while something
// is actually in front of the picture, and an unchanged one is never re-encoded.

/** Enough of a browser for TvSiting: the layer, the frame, a canvas to mask with, and a clock. */
function browser(t: TestContext) {
  const encodes: string[] = [];
  const style = () => ({
    setProperty(k: string, v: string) {
      (this as unknown as Record<string, string>)[k] = v;
    },
    removeProperty(k: string) {
      delete (this as unknown as Record<string, string>)[k];
    },
  });
  const element = (name: string) => {
    const kids: unknown[] = [];
    return {
      name,
      className: '',
      kids,
      style: style(),
      clientWidth: 1280,
      clientHeight: 720,
      setAttribute: () => {},
      addEventListener: () => {},
      remove: () => {},
      append: (...more: unknown[]) => kids.push(...more),
      ownerDocument: null as unknown,
    };
  };
  const layer = element('div');
  const body = element('body');
  const context = {
    createImageData: (w: number, h: number) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
    putImageData: () => {},
  };
  const canvas = Object.assign(element('canvas'), {
    width: 0,
    height: 0,
    getContext: () => context,
    toDataURL: () => {
      encodes.push(`mask-${encodes.length}`);
      return `data:image/png;base64,mask-${encodes.length}`;
    },
  });
  const document = {
    body,
    // Everything the page makes belongs to the page: drunkframe.ts hangs its filter on the body.
    createElement: (name: string) => own(name === 'canvas' ? canvas : element(name)),
    createElementNS: (_ns: string, name: string) => own(element(name)),
    getElementById: (id: string) => (id === 'stream-layer' ? layer : null),
  };
  function own<T extends { ownerDocument: unknown }>(el: T): T {
    el.ownerDocument = document;
    return el;
  }
  for (const el of [layer, body, canvas]) own(el);
  let now = 1000;
  const previous = {
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
    performance: Object.getOwnPropertyDescriptor(performance, 'now'),
  };
  const set = (name: string, value: unknown) => Object.defineProperty(globalThis, name, { configurable: true, writable: true, value });
  set('document', document);
  set('window', { innerWidth: 1280, innerHeight: 720 });
  Object.defineProperty(performance, 'now', { configurable: true, writable: true, value: () => (now += 16) });
  t.after(() => {
    for (const [name, had] of Object.entries(previous)) {
      if (had) Object.defineProperty(name === 'performance' ? performance : globalThis, name, had);
      else Reflect.deleteProperty(name === 'performance' ? performance : globalThis, name);
    }
  });
  return { layer, canvas, encodes, tick: () => (now += 200) };
}

test('the frame wears a mask only while something is in front of the picture', async (t) => {
  const fake = browser(t);
  const { TvSiting } = await import('../src/client/tv-siting.js');
  const tv = tvScreen();
  const siting = new TvSiting(tv);
  const camera = new PerspectiveCamera(70, 16 / 9, 0.1, 200);
  camera.position.set(14, 1.6, -10);
  camera.lookAt(tv.position);
  camera.updateMatrixWorld(true);
  // Someone stood in the way: a person-sized box between you and the picture.
  const person: Collider[] = [{ minX: 13.6, maxX: 14.4, minZ: -5, maxZ: -4, bottom: 0, top: 2.4 }];
  const bare = () => siting.frame.style.maskImage ?? '';
  // The picture is on: the frame is transformed onto the TV's rectangle and carries no mask at all.
  siting.update(camera, true, [], true);
  assert.match(siting.frame.style.transform, /^matrix3d\(/);
  assert.equal(bare(), '');
  assert.equal(fake.encodes.length, 0, 'nothing is in the way, so there is no mask to encode');
  // They walk in front of it: now it is masked, and the mask is encoded once.
  fake.tick();
  siting.update(camera, true, person, true);
  assert.match(bare(), /^url\("data:image\/png/);
  assert.equal(fake.encodes.length, 1);
  // Still standing there: the mask is left on rather than encoded again and put back over the video.
  fake.tick();
  siting.update(camera, true, person, true);
  assert.equal(fake.encodes.length, 1, 'an unchanged mask was re-encoded');
  // They walk off again, and the frame goes back to being a plain layer, which is the cheap one.
  fake.tick();
  siting.update(camera, true, [], true);
  assert.equal(bare(), '');
  assert.equal(fake.encodes.length, 1);
  assert.equal(fake.layer.style.display ?? '', '', 'and the picture is still there');
});

test('a new link wears no mask, and the old one\u2019s is taken off', async (t) => {
  const fake = browser(t);
  const { TvSiting } = await import('../src/client/tv-siting.js');
  const siting = new TvSiting(tvScreen());
  const camera = new PerspectiveCamera(70, 16 / 9, 0.1, 200);
  camera.position.set(14, 1.6, -10);
  camera.lookAt(14, 2.4, 0);
  camera.updateMatrixWorld(true);
  const person: Collider[] = [{ minX: 13.6, maxX: 14.4, minZ: -5, maxZ: -4, bottom: 0, top: 2.4 }];
  siting.update(camera, true, person, true);
  assert.match(siting.frame.style.maskImage ?? '', /^url\(/);
  siting.forget();
  assert.equal(siting.frame.style.maskImage ?? '', '');
  // And the mask that comes after it, for the same furniture, is worked out afresh.
  fake.tick();
  siting.update(camera, true, person, true);
  assert.equal(fake.encodes.length, 2);
});

test('with nothing on, the layer comes down rather than showing an empty screen', async (t) => {
  const fake = browser(t);
  const { TvSiting } = await import('../src/client/tv-siting.js');
  const siting = new TvSiting(tvScreen());
  const camera = new PerspectiveCamera(70, 16 / 9, 0.1, 200);
  camera.position.set(14, 1.6, -10);
  camera.lookAt(14, 2.4, 0);
  camera.updateMatrixWorld(true);
  // The TV is off, or off the map, or behind you: no picture, so none of the frame on the screen.
  for (const show of [false, true]) {
    fake.tick();
    siting.update(camera, show, [], false);
    assert.equal(fake.layer.style.display, 'none');
  }
});
