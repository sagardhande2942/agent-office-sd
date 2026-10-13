import * as THREE from 'three';
import { THEATRE_SWITCH, TV } from '../../shared/layout';
import { TV_LIGHT_ORDER, TV_LIGHTS, type TvLight } from '../../shared/tv';
import { mesh, roundedBox, textPlane, toon } from './toon';
import type { Interactable } from './office';

// The switch on the wall beside the lounge TV, and the light the screen throws on the wall round it.
// It walks through the room's three settings — lights up, a warm dim, lights out — so the picture on
// the TV can stand out without the office going dark to look at it (see features/tv/lighting.ts).
// The setting is the floor's rather than yours, and rides with the TV's (see shared/tv.ts); this is
// only what the plate looks like while it changes.

/** How far the rocker rests over for each setting, and how fast it gets there. */
const TILT: Record<TvLight, number> = { bright: 0.4, dim: 0, off: -0.4 };
const FLIP = 8;
/** The colour of the lamp over the rocker in each setting: dark while the lights are up. */
const LAMP: Record<TvLight, string> = { bright: '#3a3d55', dim: '#ffd08a', off: '#ffb703' };
/** How fast the light off the screen comes up and goes, so it trails the room a little. */
const SPILL = 1.1;
/** How bright the spill on the wall round the screen gets at full, and how much of it a dim room takes. */
const SPILL_MAX = 0.5;
const SPILL_DIM = 0.12;

export interface TheatreView {
  group: THREE.Group;
  /** The switch and the screen's spill are one thing: you walk up to either. */
  interactable: Interactable;
  /**
   * Which of the three settings the room is in, and whether the screen has a picture on it — a link,
   * or somebody sharing theirs — to light the wall with.
   */
  show(light: TvLight, lit: boolean): void;
  update(dt: number): void;
}

/** A soft round falloff, for the light the screen throws on the wall round it. */
function spillTexture(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 10, 64, 64, 64);
  grad.addColorStop(0, 'rgba(255,255,255,0.9)');
  grad.addColorStop(0.45, 'rgba(255,255,255,0.3)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

/**
 * The theatre switch by the TV: a plate on the wall with a rocker on it, hinged along its bottom
 * edge, and a little lamp over the rocker that lights with the setting it's in. The rocker rests at
 * three positions — up for the lights as usual, level for a warm dim, down for out. Unlit materials
 * throughout, both — the room's own light is what the switch takes away, and a switch that went dark
 * with it would be no use to anyone.
 */
export function buildTheatre(): TheatreView {
  const group = new THREE.Group();

  const plate = new THREE.Group();
  plate.position.set(THEATRE_SWITCH.x, THEATRE_SWITCH.y, THEATRE_SWITCH.z);
  plate.rotation.y = THEATRE_SWITCH.rotY;
  plate.add(mesh(roundedBox(0.28, 0.4, 0.05, 0.05), toon('#d8d2c4'), 0, 0, 0.02, false));
  plate.add(mesh(roundedBox(0.22, 0.33, 0.05, 0.04), toon('#f2ede2'), 0, 0, 0.03, false));
  const rocker = new THREE.Group();
  rocker.position.set(0, -0.05, 0.06);
  rocker.add(mesh(roundedBox(0.12, 0.17, 0.045, 0.025), toon('#e6e0d2'), 0, 0.085, 0, false));
  plate.add(rocker);
  // The lamp above the rocker, and a little screen of an emoji to say what the switch is for. Both
  // unlit, so they keep showing in a room the switch has just put out.
  const lampMat = new THREE.MeshBasicMaterial({ color: LAMP.bright });
  plate.add(mesh(new THREE.CircleGeometry(0.022, 12), lampMat, 0, 0.155, 0.062, false));
  const label = textPlane('🎬', { size: 44 });
  label.scale.multiplyScalar(0.3);
  label.position.set(0, -0.135, 0.062);
  plate.add(label);
  // A little screen of an emoji to say what the switch is for, and the setting it's in under it, so
  // the plate reads from across the room rather than only from under your nose.
  const signs = TV_LIGHT_ORDER.map((mode) => {
    const sign = textPlane(TV_LIGHTS[mode].icon, { size: 44 });
    sign.scale.multiplyScalar(0.3);
    sign.position.set(0, 0.215, 0.062);
    plate.add(sign);
    return [mode, sign] as const;
  });
  group.add(plate);

  // The light the picture throws on the wall round the screen: a soft patch on the wall, which only
  // shows while the room is dark and the screen has something on it. It sits between the screen and
  // the wall, so the bezel hides the middle of it and all you see is the spill round the edge —
  // whichever way the picture is drawn, over the canvas or on the screen itself.
  const spill = new THREE.Mesh(
    new THREE.PlaneGeometry(TV.width * 1.8, TV.height * 2.1),
    new THREE.MeshBasicMaterial({ map: spillTexture(), color: '#cfe2ff', transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }),
  );
  spill.position.set(TV.x + 0.08, TV.y, TV.z);
  spill.rotation.y = THEATRE_SWITCH.rotY;
  spill.renderOrder = 2;
  spill.visible = false;
  group.add(spill);

  let light: TvLight = 'bright';
  let lit = false;
  const show = (mode: TvLight, hasPicture: boolean) => {
    light = mode;
    lit = hasPicture;
  };

  const update = (dt: number) => {
    // The rocker settles into the setting's own resting angle and the lamp lights its colour; the
    // room itself eases down and warms in Sky, over about a second.
    rocker.rotation.x += (TILT[light] - rocker.rotation.x) * Math.min(1, dt * FLIP);
    lampMat.color.set(LAMP[light]);
    for (const [mode, sign] of signs) sign.visible = mode === light;
    // The screen's light on the wall round it, in the middle setting just a little of what it is in
    // the dark — a dimmed room has its own light to compete with.
    const want = lit ? (light === 'off' ? SPILL_MAX : light === 'dim' ? SPILL_DIM : 0) : 0;
    spill.material.opacity += (want - spill.material.opacity) * Math.min(1, dt * SPILL);
    spill.visible = spill.material.opacity > 0.01;
  };

  // You use it standing a stride out from the wall, with the plate in reach.
  const interactable: Interactable = { kind: 'theatre', x: THEATRE_SWITCH.x - 1.1, z: THEATRE_SWITCH.z, radius: 1.9 };
  plate.userData.interact = interactable;
  rocker.rotation.x = TILT.bright;

  return { group, interactable, show, update };
}
