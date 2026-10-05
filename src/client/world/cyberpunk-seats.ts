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
import { WALL, CyberMats, neonMat, Kit, Steam, paintAd, PROPS, buildShell, buildDais, buildTables, placeSetting, lectern, buildCouncil, buildBoards, buildHerald, buildEscort } from './cyberpunk';


/** Puts up the plaza in `plan` (a cyberpunk-style map). */
export function buildCyberpunk(plan: MapPlan): World {
  const c = plan.config!;
  const b = plan.bounds;
  const H = plan.height;
  const pal = { stone: '#2b323e', floor: '#1b1f28', trim: '#2de2e6', ...(c.palette ?? {}) };
  const group = new THREE.Group();
  const mats: CyberMats = {
    wall: toon(pal.stone),
    floor: toon(pal.floor),
    steel: toon('#5b6472'),
    steelDark: toon('#2c313b'),
    dark: toon('#1b1e26'),
    darkAlt: toon('#232733'),
    neon: neonMat,
    white: toon('#e9eef5'),
    gold: toon('#ffd60a'),
    seat: toon('#ff2c9c'),
  };
  const props = c.props ?? [];
  const kit: Kit = {
    group,
    still: new THREE.Group(),
    colliders: [],
    interactables: [],
    mats,
    height: H,
    bounds: b,
    ledColor: pal.trim,
    desks: new Map(),
    banners: [],
    holos: [],
    screens: [],
    neons: [],
    flames: [],
    pillars: props.filter((p) => p.kind === 'pillar').map((p) => ({ x: p.x, z: p.z })),
    floorAt(x, z) {
      let top = 0;
      for (const cc of kit.colliders) if (cc.top < 50 && !cc.fence && cc.top > top && x > cc.minX && x < cc.maxX && z > cc.minZ && z < cc.maxZ) top = cc.top;
      return top;
    },
  };
  kit.steam = new Steam(props.filter((p) => p.kind === 'vent').length * 14);
  const shell = buildShell(kit, plan, { floor: pal.floor, stone: pal.stone, trim: pal.trim });
  buildDais(kit, plan);
  for (const p of props) PROPS[p.kind as PropKind](kit, p);
  buildTables(kit, plan);
  const overflow = new Map<string, Interactable>();
  for (const def of plan.desks) kit.desks.set(def.id, placeSetting(kit, def, false).view);
  for (const def of plan.overflow) {
    const { view, it } = placeSetting(kit, def, true);
    kit.desks.set(def.id, view);
    overflow.set(def.id, it);
  }
  for (const def of plan.stations) kit.desks.set(def.id, lectern(kit, def));
  const council = buildCouncil(kit, plan);
  const boardMeshes = buildBoards(kit, plan);
  const herald = buildHerald(kit, plan);
  const escort = buildEscort(kit, plan);
  group.add(kit.steam.points);
  group.add(mergeByMaterial(kit.still));

  // Walking about: in through the doorway and out again, round what's in the way.
  const nav = new NavGrid(b, plan.obstacles!);
  const { doorAt, out, gate } = shell;
  const inside: Pt = [plan.door.x, plan.door.z];
  const threshold: Pt = [doorAt.x + out[0] * 0.2, doorAt.z + out[1] * 0.2];
  const beyond: Pt = [doorAt.x + out[0] * 3.5, doorAt.z + out[1] * 3.5];
  const gongAt = kit.gong?.top;

  // What setLook and setProjectName were last told, which the ad boards show.
  let name = '';
  let look: FloorPalette = { name: '', wall: pal.stone, trim: pal.trim, floor: pal.floor, floorAlt: pal.floor, seam: pal.floor };
  const repaint = () => {
    for (const bn of kit.banners) {
      paintAd(bn.tex.image.getContext('2d') as CanvasRenderingContext2D, bn.w, bn.h, look.trim || pal.trim, bn.great ? name : undefined);
      bn.tex.needsUpdate = true;
    }
  };

  return {
    plan,
    group,
    colliders: kit.colliders,
    interactables: kit.interactables,
    pickables: [group],
    desks: kit.desks,
    boardMeshes,
    meetingBoard: council.board,
    meetingSign: council.sign,
    gong: kit.gong,
    nav,
    ways: {
      home: (seat, from) => ({ way: [...(from ? nav.route(from, inside) : nav.wayFrom(seat, inside)), threshold, beyond], chute: false }),
      in: (seat) => [beyond, threshold, ...nav.wayTo(inside, seat)],
    },
    rain: [{ area: b, top: () => H - 1.2 }],
    device: 'laptop',
    room: { wall: WALL, enclosed: true },
    acoustics: {
      gong: gongAt ? { x: gongAt.x, y: gongAt.y - 1.6, z: gongAt.z } : null,
      windows: [
        { x: 0, y: 4, z: b.maxZ - 0.5 },
        { x: -b.maxX + 0.5, y: 6, z: 0 },
        { x: b.maxX - 0.5, y: 6, z: 0 },
        { x: 0, y: 8, z: b.minZ + 0.5 },
      ],
    },
    escort,
    herald,
    setBeanbags(outNow) {
      for (const [id, it] of overflow) {
        const show = outNow.has(id);
        kit.desks.get(id)!.group.visible = show;
        it.off = !show;
      }
      return [];
    },
    setLook(p) {
      look = p;
      repaint();
    },
    setProjectName(n) {
      if (n === name) return;
      name = n;
      repaint();
    },
    update(t, dt, people) {
      // The neon flickers, the holograms turn, the ads scroll, the rain falls.
      for (const n of kit.neons) {
        const k = 0.86 + 0.1 * Math.sin(t * 5.5 + n.phase) + 0.04 * Math.sin(t * 27 + n.phase * 3);
        n.light.intensity = n.base * k * (Math.sin(t * 0.7 + n.phase) > -0.96 ? 1 : 0.25);
      }
      for (const f of kit.flames) {
        const k = 0.85 + 0.12 * Math.sin(t * 13 + f.phase) + 0.08 * Math.sin(t * 29 + f.phase * 2);
        f.group.scale.y = (f.size || 1) * k;
        f.group.rotation.y = t * 2 + f.phase;
        f.glow.material.opacity = 0.5 + 0.3 * k;
      }
      for (const h of kit.holos) {
        h.core.rotation.y = t * 0.6 + h.phase;
        h.core.position.y = h.baseY + Math.sin(t * 1.3 + h.phase) * 0.08;
        const k = 0.75 + 0.2 * Math.sin(t * 6 + h.phase) + (Math.sin(t * 0.43 + h.phase) > 0.985 ? -0.55 : 0);
        h.glow.material.opacity = Math.max(0.1, k);
        (h.cone.material as THREE.MeshBasicMaterial).opacity = 0.08 + 0.06 * k;
      }
      for (const s of kit.screens) {
        s.tex.offset.y = (s.tex.offset.y + dt * s.speed) % 1;
        s.base.opacity = 0.88 + 0.1 * Math.sin(t * 9 + s.speed * 100);
      }
      kit.steam?.update(t);
      const R = kit.rain;
      if (R) {
        for (let i = 0; i < R.n; i++) {
          const home = R.homes[i];
          const y = (((home[1] - t * home[3] * 26) % 46) + 46) % 46 - 6;
          R.pos[i * 6] = home[0];
          R.pos[i * 6 + 1] = y;
          R.pos[i * 6 + 2] = home[2];
          R.pos[i * 6 + 3] = home[0] + 0.06;
          R.pos[i * 6 + 4] = y - 1.3;
          R.pos[i * 6 + 5] = home[2];
        }
        R.lines.geometry.attributes.position.needsUpdate = true;
      }
      (gate.material as THREE.MeshBasicMaterial).opacity = 0.07 + 0.05 * (0.5 + 0.5 * Math.sin(t * 1.7));
      for (const d of kit.desks.values()) {
        if (!d.vacancy.visible || !d.group.visible || d.def.station) continue;
        d.vacancy.position.y = d.vacancyY + Math.sin(t * 2 + d.def.x) * 0.06;
        d.vacancy.rotation.y = t * 1.2;
      }
      kit.gong?.update(dt);
      herald?.person.update(dt, t, false, false);
    },
    mood(lights, _daylight) {
      // Night, whatever the sky says: a violet haze, the city's glow, and the neon doing the lighting.
      lights.hemi.color.set('#2c1a4d');
      lights.hemi.groundColor.set('#161028');
      lights.hemi.intensity = 0.7;
      lights.ambient.color.set('#573272');
      lights.ambient.intensity = 0.62;
      lights.sun.intensity *= 0.16;
      const fog = lights.scene.fog as THREE.Fog | null;
      if (fog) {
        fog.color.set('#2a1240');
        fog.near = 30;
        fog.far = 300;
      }
    },
    dispose() {
      const freed = new Set<THREE.Material>();
      group.traverse((o) => {
        const m = o as THREE.Mesh;
        m.geometry?.dispose();
        for (const mat of Array.isArray(m.material) ? m.material : m.material ? [m.material] : []) {
          const map = (mat as THREE.MeshBasicMaterial).map;
          if (!map || freed.has(mat)) continue;
          map.dispose();
          mat.dispose();
          freed.add(mat);
        }
      });
    },
  };
}
