/**
 * The smart speaker standing against the lounge's east wall, between the Services board and the TV: a
 * fabric-wrapped tower with two glowing rings, an equalizer on its face and a pool of light on the
 * floor. Its rings and bars breathe while it plays, and go dim when it doesn't.
 *
 * It stands in the office's own floor plan (see world/office/build.ts), so walking into it stops you
 * and aiming at it finds it; what it does then is open its music player (see index.ts).
 */
import * as THREE from 'three';
import { FLOOR } from '../../../shared/layout';
import { mesh, roundedBox, toon, toonUnique } from '../../world/toon';
import type { Collider, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';

/**
 * Where the speaker stands: on the floor against the office's east wall, in the gap between the
 * Services board and the lounge TV, facing into the room (-x). `y` is its base, `height` its top; you
 * stand in front of it (out the side `rotY` turns its face to) to open its music player (see index.ts).
 * It's the speaker's own constant, as the jukebox's home is shared/jukebox.ts's: nothing off the client
 * needs it.
 */
export const SPEAKER = { x: FLOOR.maxX - 0.58, y: 0, z: -4.3, rotY: -Math.PI / 2, width: 0.62, depth: 0.62, height: 1.12 } as const;

export interface SpeakerView {
  group: THREE.Group;
  collider: Collider;
  interactable: Interactable;
  /** Where the sound comes from, for how it fades as you walk away (see index.ts). */
  readonly at: THREE.Vector3;
  /** Lit and breathing while it plays; dim and still when it doesn't. */
  setPlaying(playing: boolean): void;
  /** Animate it each frame; `calm` (the system asks for less motion) quiets the pulse. */
  update(t: number, dt: number, calm: boolean): void;
  /** How hard it's pulsing right now, 0 while it's silent (for diagnostics). */
  pulse(): number;
}

/** The fabric the tower is wrapped in: a dark charcoal weave, drawn once and shared. */
function weave(): THREE.CanvasTexture {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  g.fillStyle = '#22232d';
  g.fillRect(0, 0, 128, 128);
  for (let y = 0; y < 128; y += 8) {
    for (let x = 0; x < 128; x += 8) {
      g.fillStyle = (x / 8 + y / 8) % 2 === 0 ? '#191a22' : '#2b2d3a';
      g.beginPath();
      g.arc(x + 4, y + 4, 2.7, 0, Math.PI * 2);
      g.fill();
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(3, 2);
  t.anisotropy = 4;
  return t;
}

/** The bar equalizer's width and where on the fabric its bars stand. */
const BAR = { width: 0.05, tall: 0.4, depth: 0.018, base: 0.33, each: 0.072 };

export function buildSpeaker(): SpeakerView {
  const { x, y, z, rotY, width: W, height: H } = SPEAKER;
  const group = new THREE.Group();
  group.position.set(x, y, z);
  group.rotation.y = rotY;

  // The plinth it stands on, and the fabric-wrapped tower.
  group.add(mesh(roundedBox(W, 0.05, W, 0.03), toon('#14151d'), 0, 0.025, 0));
  const fabric = new THREE.MeshToonMaterial({ map: weave(), gradientMap: (toon('#fff') as THREE.MeshToonMaterial).gradientMap });
  const body = mesh(new THREE.CylinderGeometry(0.235, 0.255, 0.94, 36), fabric, 0, 0.52, 0);
  group.add(body);
  // Its top: a trim cap you set it with, the touch disc, and the little ring that says it heard you.
  group.add(mesh(new THREE.CylinderGeometry(0.215, 0.235, 0.055, 36), toon('#3a3d52'), 0, 0.997, 0));
  group.add(mesh(new THREE.CylinderGeometry(0.135, 0.135, 0.014, 28), toon('#1b1c26'), 0, 1.03, 0));

  // The LEDs: a ring near the top, another at the base, and the small one on top.
  const led = toonUnique('#4cc9f0');
  led.emissive = new THREE.Color('#4cc9f0');
  const barMat = toonUnique('#7cf7d4');
  barMat.emissive = new THREE.Color('#7cf7d4');
  const ring = (radius: number, tube: number, at: number) => {
    const m = mesh(new THREE.TorusGeometry(radius, tube, 8, 44), led, 0, at, 0, false);
    m.rotation.x = Math.PI / 2;
    group.add(m);
  };
  ring(0.238, 0.015, 0.885);
  ring(0.257, 0.015, 0.115);
  ring(0.1, 0.009, 1.042);

  // A little equalizer on its face, scaling from the base.
  const bars: THREE.Mesh[] = [];
  for (let i = 0; i < 5; i++) {
    const geo = roundedBox(BAR.width, BAR.tall, BAR.depth, 0.01);
    geo.translate(0, BAR.tall / 2, 0);
    const bar = mesh(geo, barMat, (i - 2) * BAR.each, BAR.base, 0.249, false);
    bars.push(bar);
    group.add(bar);
  }

  // The pool of light it throws on the floor around it.
  const glowMat = new THREE.MeshBasicMaterial({ color: '#4cc9f0', transparent: true, opacity: 0, depthWrite: false });
  glowMat.userData.outlineParameters = { visible: false };
  const glow = new THREE.Mesh(new THREE.RingGeometry(0.3, 0.46, 36), glowMat);
  glow.rotation.x = -Math.PI / 2;
  glow.position.y = 0.012;
  group.add(glow);

  let on = false;
  let level = 0;

  /** Dim, silent and still: what it looks like before anything is played and once it's stopped. */
  const dim = () => {
    led.emissive.set('#1d2b36');
    led.emissiveIntensity = 0.16;
    barMat.emissive.set('#173b3a');
    barMat.emissiveIntensity = 0.16;
    for (const bar of bars) bar.scale.y = 0.14;
    glowMat.opacity = 0;
    body.scale.set(1, 1, 1);
    level = 0;
  };
  dim();

  const view: SpeakerView = {
    group,
    collider: { minX: x - W / 2, maxX: x + W / 2, minZ: z - W / 2, maxZ: z + W / 2, top: H },
    // You use it standing in front of it, out the side its face turns to.
    interactable: { kind: 'speaker', x: x + Math.sin(rotY) * 1.2, z: z + Math.cos(rotY) * 1.2, radius: 1.8 },
    at: new THREE.Vector3(x, y + H * 0.6, z),
    setPlaying(playing: boolean) {
      if (playing === on) return;
      on = playing;
      if (!playing) dim();
    },
    update(t: number, _dt: number, calm: boolean) {
      if (!on) return;
      // Always lit while it plays, breathing between a low glow and a bright one rather than dipping dark.
      const wave = (freq: number, phase: number) => 0.5 + 0.5 * Math.sin(t * freq + phase);
      const pulse = calm ? 0.6 : 0.45 + 0.3 * wave(2.7, 0) + 0.25 * wave(6.1, 1.3);
      level = pulse;
      const hue = (t * 0.06) % 1;
      led.emissive.setHSL(hue, 0.82, 0.55);
      led.emissiveIntensity = 0.25 + 1.8 * pulse;
      barMat.emissive.setHSL((hue + 0.12) % 1, 0.8, 0.6);
      barMat.emissiveIntensity = 0.3 + 1.5 * pulse;
      bars.forEach((bar, i) => (bar.scale.y = 0.24 + 1.5 * Math.abs(Math.sin(t * 3.1 + i * 0.85)) * (calm ? 0.55 : 1)));
      glowMat.opacity = 0.06 + 0.26 * pulse;
      // The fabric breathes with the bass, just a little.
      const swell = 1 + (calm ? 0.002 : 0.006) * pulse;
      body.scale.set(swell, 1, swell);
    },
    pulse: () => level,
  };
  // What the aim can land on: the tower carries its interactable, as every fixture does.
  group.userData.interact = view.interactable;
  return view;
}

declare module '../../world/types' {
  interface OfficeHandles {
    /** The smart speaker in the lounge (see features/speaker). */
    speaker: SpeakerView;
  }
}

/** The smart speaker, against the east wall between the Services board and the TV. */
export const speaker: Fixture<'speaker'> = (site) => {
  const built = buildSpeaker();
  // Its stretch of wall, so a picture isn't hung over it.
  site.wall('east', SPEAKER.z, SPEAKER.y + SPEAKER.height / 2, SPEAKER.width + 0.16, SPEAKER.height);
  return { group: built.group, colliders: [built.collider], interactables: [built.interactable], handle: { speaker: built } };
};
