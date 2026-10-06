import { buildCyberpunk } from './cyberpunk-seats';
export { buildCyberpunk } from './cyberpunk-seats';
import { buildDais, buildTables, placeSetting, lectern, councilChair, buildCouncil, buildBoards, buildHerald, corpsSec, buildEscort } from './cyberpunk-shell';
export { buildDais, buildTables, placeSetting, lectern, councilChair, buildCouncil, buildBoards, buildHerald, corpsSec, buildEscort } from './cyberpunk-shell';
import { uplight, halo, streakTexture, floorGlow, ceilingPanel, wallDetail, truss, cable, buildShell } from './cyberpunk-lights';
export { uplight, halo, streakTexture, floorGlow, ceilingPanel, wallDetail, truss, cable, buildShell } from './cyberpunk-lights';
import { billboardProp, hologram, vending, cases, grate, barrier, wallLamp, fireDrum, ringLight, adBoard, cityWindow, porthole, floorStrip, chromeStatue, sentry, plaque, videoWall, drinksFridge, steelTable } from './cyberpunk-props';
export { billboardProp, hologram, vending, cases, grate, barrier, wallLamp, fireDrum, ringLight, adBoard, cityWindow, porthole, floorStrip, chromeStatue, sentry, plaque, videoWall, drinksFridge, steelTable } from './cyberpunk-props';
import { asphalt, panels, neonSign, billboard, skyline, towerFace, hazard, neonMat, flat, rod, tube, neonLight, placed, collide, paintAd, column, neonSignProp, shopfront } from './cyberpunk-textures';
export { asphalt, panels, neonSign, billboard, skyline, towerFace, hazard, neonMat, flat, rod, tube, neonLight, placed, collide, paintAd, column, neonSignProp, shopfront } from './cyberpunk-textures';
import * as THREE from 'three';
import type { FloorPalette } from '../../shared/floors';
import { KIOSK, STATION_AGENT, deskSeat, type DeskDef, type StationKind } from '../../shared/layout';
import { BENCH_OUT, BOARD_KEYS, COUNCIL, THRONE_SIZE, type BoardKey, type MapPlan, type PropConfig } from '../../shared/maps';
import { PROP_SIZE, boxFootprint, type PropKind } from '../../shared/maps/props';
import { NavGrid, deskPoint, type Pt } from '../../shared/nav';
import { Person } from './character';
import { glowTexture } from './costumes';
import { buildGong, type Gong } from '../features/gong/world';
import { vacancyMarker, type Collider, type DeskView, type Interactable } from './office';
import { canvasTexture, seeded, shade } from './textures';
import { mergeByMaterial, mesh, roundedBox, textPlane, toon, toonUnique } from './toon';
import type { World } from './world';

/*
 * The cyberpunk style of map (see shared/maps/cyberpunk.ts for the plaza itself): a neon concourse
 * under a steel ceiling, lit by signs, holo billboards and LED strips, with the rain-slick city
 * showing through the glazing at the ends. The workers sit at console benches in the arcade, the
 * boards hang on the side walls between the shopfronts, and at the north end a chrome dais carries
 * the boss's chair, its fixer, and a wall of neon behind. Everything is placed from the map's plan,
 * so another map in this style is just other numbers.
 */

/** How thick the outside walls are. */
export const WALL = 0.6;
export const TABLE_TOP = 0.78;
export const BENCH_TOP = 0.46;
export const DOORWAY = { width: 6, height: 5.6 } as const;
/** The most neon lights that light the plaza for real (the rest just glow). */
export const MAX_LIGHTS = 14;
/** The shopfronts: a wide sign is a shop's, so a doorway and its glow are built under it. */
export const SHOP_W = 2.9;

// ---- Materials, glow and the kit ------------------------------------------------------------------

export interface CyberMats {
  wall: THREE.Material;
  floor: THREE.Material;
  /** Painted steel: the dais, the frames, the gantry. */
  steel: THREE.Material;
  steelDark: THREE.Material;
  /** The benches and consoles. */
  dark: THREE.Material;
  darkAlt: THREE.Material;
  /** Anything that glows for real. */
  neon: (color: string) => THREE.MeshToonMaterial;
  white: THREE.Material;
  gold: THREE.Material;
  seat: THREE.Material;
}

export const box = (w: number, h: number, d: number) => new THREE.BoxGeometry(w, h, d);

/** A toon material with a picture on it (asphalt, panels). */
export const toonMap = (map: THREE.Texture) => new THREE.MeshToonMaterial({ color: '#ffffff', map, gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
/** A flat, unlit material with a picture on it (a sign's glowing face, a billboard). */
export const flatMap = (map: THREE.Texture, opts: { transparent?: boolean } = {}) =>
  new THREE.MeshBasicMaterial({ map, transparent: !!opts.transparent, side: THREE.DoubleSide, toneMapped: false });

export const GLASS = new THREE.MeshBasicMaterial({ color: '#a9d4ff', transparent: true, opacity: 0.11, depthWrite: false, side: THREE.DoubleSide });

/** What the builder hands the props: where to put meshes, what's in the way, and what animates. */
export interface Kit {
  /** The top of whatever the floor is at (x, z): the dais, or the floor. */
  floorAt(x: number, z: number): number;
  group: THREE.Group;
  /** Merged into a few draw calls at the end: whatever never moves. */
  still: THREE.Group;
  colliders: Collider[];
  interactables: Interactable[];
  mats: CyberMats;
  height: number;
  /** The plaza's footprint, for the shell's spans. */
  bounds: MapPlan['bounds'];
  /** The floor's own color: the plaza's neon, and every project's floor paints itself with it. */
  ledColor: string;
  /** The columns the map asked for, for the gantry over them. */
  pillars: { x: number; z: number }[];
  /** The rain over the city, seen through the glass. */
  rain?: { lines: THREE.LineSegments; pos: Float32Array; homes: number[][]; n: number };
  /** Every seat by id, as it's built. */
  desks: Map<string, DeskView>;
  /** What paints itself over later, in a floor's own color: the ad boards. */
  banners: { tex: THREE.CanvasTexture; w: number; h: number; great: boolean }[];
  /** The plaza's holograms, signs and lights, animated each frame. */
  holos: Holo[];
  screens: Screen[];
  neons: Neon[];
  flames: Flame[];
  steam?: Steam;
  gong?: Gong;
}

/** A flame: cones that flicker, with their glow. */
export interface Flame {
  group: THREE.Object3D;
  glow: THREE.Sprite;
  size: number;
  phase: number;
}

export const FLAME_OUTER = new THREE.ConeGeometry(0.45, 1, 8).translate(0, 0.5, 0);
export const FLAME_INNER = new THREE.ConeGeometry(0.25, 0.7, 8).translate(0, 0.35, 0);
export const FLAME_OUT = new THREE.MeshBasicMaterial({ color: '#ff8c2a', toneMapped: false });
export const FLAME_IN = new THREE.MeshBasicMaterial({ color: '#ffe38a', toneMapped: false });
FLAME_OUT.userData.outlineParameters = { visible: false };
FLAME_IN.userData.outlineParameters = { visible: false };

/** A hologram hanging over its projector. */
export interface Holo {
  group: THREE.Group;
  core: THREE.Object3D;
  cone: THREE.Mesh;
  glow: THREE.Sprite;
  color: THREE.Color;
  phase: number;
  /** The height its core turns at (a floor projector's, or the meeting table's). */
  baseY: number;
}

/** A billboard's picture, scrolled and flickered. */
export interface Screen {
  tex: THREE.CanvasTexture;
  /** How fast the picture scrolls (0: it just flickers). */
  speed: number;
  base: THREE.MeshBasicMaterial;
}

/** A neon light, its color pulsing. */
export interface Neon {
  light: THREE.PointLight;
  base: number;
  phase: number;
  color: THREE.Color;
}

/** The steam off the street grates: one drift of points over them all. */
export class Steam {
  readonly points: THREE.Points<THREE.BufferGeometry, THREE.PointsMaterial>;
  private pos: Float32Array;
  private home: number[] = [];
  private phases: number[] = [];
  private n = 0;

  constructor(private max: number) {
    this.pos = new Float32Array(max * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const mat = new THREE.PointsMaterial({ size: 1.1, map: glowTexture(), color: '#cfe6ff', transparent: true, opacity: 0.3, depthWrite: false, blending: THREE.AdditiveBlending });
    mat.userData.outlineParameters = { visible: false };
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
  }

  /** A grate at (x, y, z) lets off `per` drifting puffs. */
  add(x: number, y: number, z: number, per = 14) {
    for (let i = 0; i < per && this.n < this.max; i++, this.n++) {
      this.home.push(x, y, z);
      this.phases.push(i / per + Math.random() * 0.08);
    }
  }

  update(t: number) {
    for (let i = 0; i < this.n; i++) {
      const k = (this.phases[i] + t * 0.14) % 1;
      const spread = 0.1 + k * 1.1;
      this.pos[i * 3] = this.home[i * 3] + Math.sin(this.phases[i] * 40 + t * 0.6) * spread;
      this.pos[i * 3 + 1] = this.home[i * 3 + 1] + k * 2.6;
      this.pos[i * 3 + 2] = this.home[i * 3 + 2] + Math.cos(this.phases[i] * 31 + t * 0.5) * spread;
    }
    this.points.geometry.attributes.position.needsUpdate = true;
  }
}

export const signText = (p: PropConfig, fallback: string) => (p.text ?? fallback).slice(0, 24);

/** Every kind of prop, put up (every kind there is has one: see PROP_KINDS). */
export const PROPS: Record<PropKind, (kit: Kit, p: PropConfig) => void> = {
  pillar: column,
  torch: wallLamp,
  brazier: fireDrum,
  chandelier: ringLight,
  banner: adBoard,
  window: cityWindow,
  rose: porthole,
  carpet: floorStrip,
  statue: chromeStatue,
  armor: sentry,
  shield: plaque,
  hearth: videoWall,
  gong: (kit, p) => {
    const gong = buildGong({ x: p.x, y: kit.floorAt(p.x, p.z), z: p.z, rotY: p.rotY ?? 0 });
    kit.group.add(gong.group);
    kit.colliders.push(...gong.colliders);
    kit.interactables.push(gong.interactable);
    kit.gong = gong;
  },
  cask: (kit, p) => kit.interactables.push(drinksFridge(kit, p)),
  table: steelTable,
  candles: uplight,
  sign: neonSignProp,
  screen: billboardProp,
  holo: hologram,
  machine: (kit, p) => kit.interactables.push(vending(kit, p)),
  crate: cases,
  vent: grate,
  barrier,
};

/** The streak a sign or a screen throws on the wet floor, fading as it runs into the room. */
