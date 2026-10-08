/**
 * Where the TV's picture goes on your screen, frame by frame: the element that plays it is laid over
 * the canvas and re-projected onto the TV's rectangle, because WebGL can't draw a cross-origin player
 * (see docs/tv-streaming.md). What *is* playing is TvScreen's business (see tvscreen.ts); this is the
 * half that puts it on the wall and takes it away again.
 *
 * Two things here cost money, so both are kept off the frame's back as far as the browser allows: the
 * occlusion mask that hides the picture behind whatever stands in front of the TV, and the styles the
 * picture wears. A mask that hides nothing is taken off rather than left on as a no-op, an unchanged
 * one is never re-encoded, and a transform that hasn't moved is not written again.
 */
import * as THREE from 'three';
import type { SceneCamera } from './features/topdown/camera';
import { store } from './state';
import { h } from './ui/dom';
import type { Collider } from './world/office';
import { DrunkPicture } from './drunkframe';
import { homography } from './tv-projection';
import { cullBodies, fillMask, maskGrid, MASK_H, MASK_W, type MaskGrid } from './tv-mask';
import type { HandCover } from './tv-youtube';

/** The picture's own size: the TV is 16:9, so what goes on it is too (see .tv-frame in style.css). */
export const WIDTH = 1280;
export const HEIGHT = 720;
/** How often the picture's occlusion is worked out (ms). People move slowly, and it isn't free. */
export const MASK_TICK = 80;

/** The layer the picture lives in, over the canvas: the picture's own half of a frame. */
export class TvSiting {
  /** The 1280×720 element that gets transformed onto the TV's corners. Whatever plays goes in it. */
  readonly frame: HTMLElement;
  /**
   * Where your own hands cover the screen just now, or null when they aren't drawn. They're over the
   * world, but the picture is ordinary HTML over the canvas the hands are painted in, so it would sit
   * on top of them; the picture hides behind them instead, as it does behind anything else in front of
   * the TV (see main.ts). Asked whenever the mask is rebuilt.
   */
  handCover: (() => HandCover | null) | null = null;
  /** The layer over the canvas (index.html); null on a page without one. */
  readonly layer: HTMLElement | null;
  /** So the picture goes with the rest of the office once you've been drinking (see drunkframe.ts). */
  private readonly drunk: DrunkPicture | null;
  private readonly corners = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  private readonly scratch = new THREE.Vector3();
  /** A second scratch for the occlusion cull, which needs the point both in view and in world space. */
  private readonly probe = new THREE.Vector3();
  private readonly eye = new THREE.Vector3();
  /** The last thing in front of each cell of the picture, as a mask for the frame (see occlude). */
  private readonly mask = document.createElement('canvas');
  private readonly maskCtx = this.mask.getContext('2d');
  private readonly maskPixels = this.maskCtx?.createImageData(MASK_W, MASK_H);
  private maskedAt = 0;
  private maskUrl = '';
  private walled = false;
  /** Whether the layer is up, so its `display` is only written when that changes (see update). It starts
   *  up: the layer has no `display` of its own, so the first frame that says otherwise has to say it. */
  private shown = true;
  /** Where the picture's cells are, and what came in front of them last time (see tv-mask.ts). */
  private grid: MaskGrid | null = null;
  /** The grid `alpha` the frame is wearing, so an unchanged mask is never re-encoded. */
  private readonly worn = new Uint8Array(MASK_W * MASK_H);
  /** The layer's size in CSS pixels, and the homography taking the picture's own pixels onto it (see sited). */
  private viewW = 0;
  private viewH = 0;
  private onto: number[] | null = null;
  /** The transform the frame is wearing, so a still camera doesn't hand the browser the same one twice. */
  private placed = '';
  /** The world matrix the cells were worked out from, the people's boxes, and the building's solids. */
  private placedAt: number[] = [];
  private readonly pool: Collider[] = [];
  private readonly bodies: Collider[] = [];
  private solidsOf: Collider[] | null = null;
  private solidOf: readonly Collider[] | null = null;
  private readonly pixels: [number, number][] = [
    [0, 0],
    [0, 0],
    [0, 0],
    [0, 0],
  ];

  constructor(private readonly screen: THREE.Mesh) {
    this.layer = document.getElementById('stream-layer');
    this.frame = h('div.tv-frame');
    this.layer?.append(this.frame);
    // Only a page with a layer ever shows the picture, so only one pays for the filter.
    this.drunk = this.layer ? new DrunkPicture(this.frame) : null;
    this.mask.width = MASK_W;
    this.mask.height = MASK_H;
  }

  /**
   * How drunk you are, so the picture on the TV goes with the rest of the office: it wobbles,
   * doubles and smears too, on the same clock as the world (see drunkframe.ts, the same effect
   * world/drunk.ts puts on the canvas). `motion` false holds it still, as it does there. Sober, the
   * picture carries no filter at all and this costs nothing.
   */
  setDrunk(amount: number, time: number, motion: boolean) {
    this.drunk?.apply(amount, time, motion);
  }

  /**
   * Every frame: keep the picture where the floor says it should be, then put it on the TV's
   * rectangle — or take it away, if the TV isn't somewhere you can see it (call after rendering).
   */
  update(camera: SceneCamera, show: boolean, colliders: readonly Collider[], playing: boolean) {
    if (!this.layer) return;
    const sited = show && playing && this.sited(camera, colliders);
    const visible = sited && !this.walled;
    // Written only when it changes: this is a layer over the whole viewport, with an iframe in it.
    if (visible === this.shown) return;
    this.shown = visible;
    this.layer.style.display = visible ? '' : 'none';
  }

  /** Takes the mask off the frame with the link that wore it (see TvScreen.clear). */
  forget() {
    this.worn.fill(255);
    this.maskedAt = 0;
    this.grid = null;
    this.placedAt = [];
    this.unmasked();
  }

  // ---- Where it goes on screen ----------------------------------------------------------------

  /** The TV's corners here and in pixels, the way it's looking now: false when it isn't in view. */
  private sited(camera: SceneCamera, colliders: readonly Collider[]): boolean {
    this.screen.updateWorldMatrix(true, false);
    const geo = this.screen.geometry;
    // The screen's rectangle never changes, so it's measured once rather than walked every frame.
    if (!geo.boundingBox) geo.computeBoundingBox();
    const box = geo.boundingBox;
    if (!box) return false;
    const local: [number, number][] = [
      [box.min.x, box.max.y],
      [box.max.x, box.max.y],
      [box.max.x, box.min.y],
      [box.min.x, box.min.y],
    ];
    // Read once a frame: asking the layer its size flushes any layout the picture's own styles left.
    const w = this.layer!.clientWidth || window.innerWidth;
    const hgt = this.layer!.clientHeight || window.innerHeight;
    for (let i = 0; i < 4; i++) {
      const corner = this.corners[i].set(local[i][0], local[i][1], 0).applyMatrix4(this.screen.matrixWorld);
      // Behind your eye: it would project inside out, so it isn't on screen at all.
      this.scratch.copy(corner).applyMatrix4(camera.matrixWorldInverse);
      if (this.scratch.z > -camera.near) return false;
      corner.project(camera);
      this.pixels[i] = [(corner.x * 0.5 + 0.5) * w, (-corner.y * 0.5 + 0.5) * hgt];
    }
    this.eye.copy(camera.position);
    const from: [number, number][] = [
      [0, 0],
      [WIDTH, 0],
      [WIDTH, HEIGHT],
      [0, HEIGHT],
    ];
    const matrix = homography(from, this.pixels);
    if (!matrix) return false;
    // Kept for the mask's own cells to be placed on the screen (see occlude).
    this.viewW = w;
    this.viewH = hgt;
    this.onto = matrix;
    const [a, b, c, d, e, f, g, i] = matrix;
    const onto = `matrix3d(${a},${d},0,${g},${b},${e},0,${i},0,0,1,0,${c},${f},0,1)`;
    // Standing still, the picture is already where it belongs: saying so again only makes the browser
    // redo the work of putting it there.
    if (onto !== this.placed) {
      this.placed = onto;
      this.frame.style.transform = onto;
    }
    // What's standing in front of it, so the picture is hidden behind it (see occlude).
    this.occlude(camera, colliders, w, hgt);
    return true;
  }

  /**
   * Puts what's between your eye and each part of the screen into the frame's own mask, so the
   * picture is hidden behind it. Ordinary HTML can't be depth-tested against the scene, and the TV
   * is only ever a metre or two from a wall, a desk, a plant or someone standing in the way — so
   * each cell of the picture is asked whether anything is in front of it. Glass you can see through
   * and fences aren't in the way; people are, and so are your own hands. Answered every MASK_TICK,
   * into a small canvas that the browser stretches over the frame (see .tv-frame in style.css), and
   * the whole frame is taken away rather than masked when every last cell is behind something.
   */
  private occlude(camera: SceneCamera, colliders: readonly Collider[], w: number, hgt: number) {
    const ctx = this.maskCtx;
    const pixels = this.maskPixels;
    if (!ctx || !pixels) return;
    const now = performance.now();
    if (now - this.maskedAt < MASK_TICK) return;
    this.maskedAt = now;
    const grid = this.gridFor();
    if (!grid) return;
    const way = this.inTheWay(camera, colliders, w, hgt);
    const bodies = cullBodies(this.people(), this.eye, grid.centre, grid.radius);
    const hands = this.handCover?.() ?? null;
    // Nothing between you and the picture at all: the frame goes back to being a plain layer.
    if (!way.length && !bodies.length && !hands) return this.unmasked();
    const hidden = fillMask(grid, this.eye, way, bodies, hands ? (u, v) => this.overHands(hands, u, v) : null);
    this.walled = hidden === grid.width * grid.height;
    // Every cell showing is the same as no mask at all, and no mask is the cheap one.
    if (!hidden) {
      this.worn.set(grid.alpha);
      return this.unmasked();
    }
    // What stands in the way moves slowly: an unchanged mask is left on the frame as it is rather
    // than encoded again and put back, which is a repaint of the whole picture.
    if (!this.changed(grid.alpha)) return;
    const data = pixels.data;
    for (let i = 0; i < grid.alpha.length; i++) {
      const j = i * 4;
      data[j] = data[j + 1] = data[j + 2] = 255;
      data[j + 3] = grid.alpha[i];
    }
    ctx.putImageData(pixels, 0, 0);
    this.worn.set(grid.alpha);
    const url = `url("${this.mask.toDataURL()}")`;
    if (url !== this.maskUrl) {
      this.maskUrl = url;
      this.frame.style.maskImage = url;
      this.frame.style.setProperty('-webkit-mask-image', url);
    }
  }

  /** Takes the mask off the frame, for a picture nothing is standing in front of. */
  private unmasked() {
    this.walled = false;
    if (!this.maskUrl) return;
    this.maskUrl = '';
    // An unmasked frame shows every cell, which is what the mask would have said anyway.
    this.worn.fill(255);
    this.frame.style.maskImage = '';
    this.frame.style.setProperty('-webkit-mask-image', '');
  }

  /** Whether the cells came to anything the frame isn't already wearing. */
  private changed(alpha: Uint8Array): boolean {
    for (let i = 0; i < alpha.length; i++) if (alpha[i] !== this.worn[i]) return true;
    return false;
  }

  /** The grid for the screen, worked out once and kept while the screen stands where it did (see tv-mask). */
  private gridFor(): MaskGrid | null {
    const elements = this.screen.matrixWorld.elements;
    if (this.grid && this.placedAt.every((v, i) => v === elements[i])) return this.grid;
    const grid = maskGrid(this.screen);
    this.grid = grid;
    this.placedAt = [...elements];
    return grid;
  }

  /**
   * The people on your floor, as the person-sized boxes they're stood in (people aren't colliders).
   * The boxes are reused: this runs a dozen times a second and a fresh object per person per pass is
   * litter for the collector.
   */
  private people(): readonly Collider[] {
    const out = this.bodies;
    out.length = 0;
    for (const p of store.peers.values()) {
      if (p.id === store.you || p.lite || !store.onMyFloor(p)) continue;
      const i = out.length;
      let box = this.pool[i];
      if (!box) this.pool[i] = box = { minX: 0, maxX: 0, minZ: 0, maxZ: 0, bottom: 0, top: 0 };
      box.minX = p.x - 0.35;
      box.maxX = p.x + 0.35;
      box.minZ = p.z - 0.35;
      box.maxZ = p.z + 0.35;
      box.bottom = p.y;
      box.top = p.y + 1.8;
      out.push(box);
    }
    return out;
  }

  /**
   * Whether your own hands are over this part of the picture, given where that part lands on your
   * screen. `u` runs across the picture and `v` down it, both 0–1, as the homography takes them to
   * the layer (see handCover).
   */
  private overHands(hands: HandCover, u: number, v: number): boolean {
    const m = this.onto;
    if (!m || !this.viewW || !this.viewH) return false;
    const x = u * WIDTH;
    const y = v * HEIGHT;
    const den = m[6] * x + m[7] * y + 1;
    if (!den) return false;
    const px = (m[0] * x + m[1] * y + m[2]) / den / this.viewW;
    const py = (m[3] * x + m[4] * y + m[5]) / den / this.viewH;
    if (px < 0 || px >= 1 || py < 0 || py >= 1) return false;
    const cx = Math.min(hands.width - 1, (px * hands.width) | 0);
    // The cover's rows are the other way up (WebGL reads a target from the bottom).
    const cy = Math.min(hands.height - 1, ((1 - py) * hands.height) | 0);
    return hands.data[(cy * hands.width + cx) * 4 + 3] > 8;
  }

  /**
   * The colliders that could possibly show up in front of the TV from here: the office has hundreds,
   * and testing every one against every cell of the mask would cost more than the rest of the frame.
   * A collider that reaches the TV's rectangle on screen (or straddles the camera, where its corners
   * say nothing) is kept; the rest of the building is culled.
   */
  private inTheWay(camera: SceneCamera, colliders: readonly Collider[], w: number, hgt: number): Collider[] {
    let tvMinX = Infinity;
    let tvMinY = Infinity;
    let tvMaxX = -Infinity;
    let tvMaxY = -Infinity;
    for (const [x, y] of this.pixels) {
      if (x < tvMinX) tvMinX = x;
      if (x > tvMaxX) tvMaxX = x;
      if (y < tvMinY) tvMinY = y;
      if (y > tvMaxY) tvMaxY = y;
    }
    const out: Collider[] = [];
    const scratch = this.scratch;
    for (const c of this.solids(colliders)) {
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      let straddles = false;
      for (let i = 0; i < 8 && !straddles; i++) {
        scratch.set(i & 1 ? c.maxX : c.minX, i & 2 ? c.top : (c.bottom ?? 0), i & 4 ? c.maxZ : c.minZ);
        if (this.probe.copy(scratch).applyMatrix4(camera.matrixWorldInverse).z > -camera.near) {
          // Behind your eye: its corners project inside out, so it can't be culled by them.
          straddles = true;
          break;
        }
        scratch.project(camera);
        const px = (scratch.x * 0.5 + 0.5) * w;
        const py = (-scratch.y * 0.5 + 0.5) * hgt;
        if (px < minX) minX = px;
        if (px > maxX) maxX = px;
        if (py < minY) minY = py;
        if (py > maxY) maxY = py;
      }
      if (straddles || (maxX >= tvMinX && minX <= tvMaxX && maxY >= tvMinY && minY <= tvMaxY)) out.push(c);
    }
    return out;
  }

  /**
   * The building as the mask wants it: glass you can see a TV through and fences, which are only there
   * to stop you walking into something, left out, and a thing with visible parts of its own reduced to
   * those parts. Flattened once per collider list rather than a dozen times a second.
   */
  private solids(colliders: readonly Collider[]): readonly Collider[] {
    if (this.solidOf !== colliders || this.solidsOf?.length !== colliders.length) {
      this.solidOf = colliders;
      this.solidsOf = colliders.flatMap(c => (c.glass || c.fence ? [] : c.occlusion ?? [c])).filter(c => !c.glass && !c.fence);
    }
    return this.solidsOf;
  }
}
