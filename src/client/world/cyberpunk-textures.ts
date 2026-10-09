import * as THREE from 'three';
import { type PropConfig } from '../../shared/maps';
import { PROP_SIZE, boxFootprint } from '../../shared/maps/props';
import { glowTexture } from './costumes';
import { type Collider } from './office';
import { canvasTexture, seeded, shade } from './textures';
import { mesh, toon, toonUnique } from './toon';
import { MAX_LIGHTS, SHOP_W, box, flatMap, Kit, signText, floorGlow } from './cyberpunk';


// ---- Textures -------------------------------------------------------------------------------------

/** Rain-slick asphalt: dark, mottled, with a faint sheen down the middle. */
export function asphalt(color: string): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    const rand = seeded(21);
    g.fillStyle = color;
    g.fillRect(0, 0, 512, 512);
    for (let i = 0; i < 2200; i++) {
      const x = rand() * 512;
      const y = rand() * 512;
      g.fillStyle = rand() < 0.5 ? shade(color, (rand() - 0.5) * 0.16) : shade(color, rand() * 0.08);
      g.fillRect(x, y, 1 + rand() * 5, 1 + rand() * 3);
    }
    // Cracks and patch seams.
    g.strokeStyle = shade(color, -0.12);
    g.lineWidth = 2;
    for (let i = 0; i < 14; i++) {
      g.beginPath();
      let x = rand() * 512;
      let y = rand() * 512;
      g.moveTo(x, y);
      for (let k = 0; k < 5; k++) {
        x += (rand() - 0.5) * 90;
        y += (rand() - 0.5) * 90;
        g.lineTo(x, y);
      }
      g.stroke();
    }
  };
}


/** A wall of concrete panels with seams and rivets: one tile is 4 m wide and 3 m high. */
export function panels(color: string, seed: number): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    const rand = seeded(seed);
    g.fillStyle = color;
    g.fillRect(0, 0, 512, 384);
    g.strokeStyle = shade(color, -0.12);
    g.lineWidth = 3;
    for (let x = 0; x <= 512; x += 128) {
      g.beginPath();
      g.moveTo(x, 0);
      g.lineTo(x, 384);
      g.stroke();
    }
    for (let y = 0; y <= 384; y += 192) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(512, y);
      g.stroke();
    }
    for (const [x, y] of [
      [10, 10],
      [502, 10],
      [10, 374],
      [502, 374],
    ] as const) {
      g.fillStyle = shade(color, 0.08);
      g.beginPath();
      g.arc(x, y, 3, 0, Math.PI * 2);
      g.fill();
    }
    for (let i = 0; i < 90; i++) {
      g.fillStyle = shade(color, (rand() - 0.6) * 0.1);
      g.fillRect(rand() * 512, rand() * 384, 20 + rand() * 60, 6 + rand() * 20);
    }
  };
}


/** A neon sign: a dark board, a steel frame, and the words in glowing tubes. */
export function neonSign(text: string, color: string): THREE.CanvasTexture {
  const W = 640;
  const H = 200;
  return canvasTexture(W, H, (g) => {
    g.fillStyle = '#0b0d13';
    g.fillRect(0, 0, W, H);
    g.strokeStyle = '#39404e';
    g.lineWidth = 8;
    g.strokeRect(4, 4, W - 8, H - 8);
    g.font = '900 104px Nunito, ui-rounded, system-ui, sans-serif';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    // The glow of the tubes, then their bright core.
    g.shadowColor = color;
    g.shadowBlur = 40;
    g.fillStyle = color;
    g.fillText(text, W / 2, H / 2 + 6);
    g.shadowBlur = 20;
    g.fillText(text, W / 2, H / 2 + 6);
    g.shadowBlur = 0;
    g.globalAlpha = 0.9;
    g.fillStyle = '#ffffff';
    g.font = '900 96px Nunito, ui-rounded, system-ui, sans-serif';
    g.fillText(text, W / 2, H / 2 + 6);
    g.globalAlpha = 1;
  });
}


/** A holographic billboard: bands of ads and glyphs that scroll, the way a holo-loop does. */
export function billboard(seed: number): THREE.CanvasTexture {
  const W = 512;
  const H = 512;
  const t = canvasTexture(W, H, (g) => {
    const rand = seeded(seed);
    const cols = ['#ff2c9c', '#2de2e6', '#ffd60a', '#39ff88', '#a06bff'];
    g.fillStyle = '#070810';
    g.fillRect(0, 0, W, H);
    let y = 0;
    while (y < H) {
      const kind = Math.floor(rand() * 3);
      const h = 70 + rand() * 90;
      const c = cols[Math.floor(rand() * cols.length)];
      if (kind === 0) {
        // A band of glyphs.
        for (let x = 14; x < W - 40; x += 54) {
          g.strokeStyle = c;
          g.lineWidth = 6;
          g.strokeRect(x, y + 14, 36, 36);
          g.beginPath();
          g.moveTo(x + 8, y + 32);
          g.lineTo(x + 28, y + 32);
          g.moveTo(x + 18, y + 22);
          g.lineTo(x + 18, y + 44);
          g.stroke();
        }
      } else if (kind === 1) {
        // A big word.
        g.font = `900 ${Math.floor(h * 0.6)}px Nunito, ui-rounded, system-ui, sans-serif`;
        g.textAlign = 'center';
        g.textBaseline = 'middle';
        g.shadowColor = c;
        g.shadowBlur = 26;
        g.fillStyle = c;
        g.fillText(['SYNTH', 'NEON', 'CHROME', 'GRID', 'VOID', 'KROME'][Math.floor(rand() * 6)], W / 2, y + h / 2);
        g.shadowBlur = 0;
      } else {
        // A product: a glossy box with a price.
        g.fillStyle = shade(c, -0.25);
        g.fillRect(40, y + 10, 150, h - 20);
        g.fillStyle = c;
        g.fillRect(46, y + 16, 138, 14);
        g.font = '900 40px Nunito, ui-rounded, system-ui, sans-serif';
        g.textAlign = 'left';
        g.textBaseline = 'middle';
        g.fillStyle = '#ffffff';
        g.fillText(`${Math.floor(rand() * 900) + 99}€`, 220, y + h / 2);
      }
      g.fillStyle = 'rgba(255,255,255,0.08)';
      g.fillRect(0, y + h - 4, W, 4);
      y += h;
    }
    // Scanlines.
    g.fillStyle = 'rgba(0,0,0,0.25)';
    for (let y = 0; y < H; y += 4) g.fillRect(0, y, W, 1);
  });
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  return t;
}


/** The city outside: towers of lit windows and neon, on a purple night. */
export function skyline(): (g: CanvasRenderingContext2D) => void {
  return (g) => {
    const rand = seeded(77);
    const grad = g.createLinearGradient(0, 0, 0, 512);
    grad.addColorStop(0, '#120a24');
    grad.addColorStop(0.55, '#2a1240');
    grad.addColorStop(1, '#4a1b52');
    g.fillStyle = grad;
    g.fillRect(0, 0, 2048, 512);
    for (let i = 0; i < 340; i++) {
      g.fillStyle = `rgba(255,255,255,${0.2 + rand() * 0.6})`;
      g.fillRect(rand() * 2048, rand() * 180, 1 + rand() * 2, 1 + rand() * 2);
    }
    // Two rows of towers, the far ones dim.
    for (const far of [true, false]) {
      for (let x = -40; x < 2048; ) {
        const w = 40 + rand() * 90;
        const h = (far ? 130 : 190) + rand() * (far ? 130 : 230);
        const base = far ? 330 : 470;
        const c = far ? shade('#2b2440', rand() * 0.06) : shade('#151222', rand() * 0.08);
        g.fillStyle = c;
        g.fillRect(x, base - h, w, h + 60);
        // Lit windows.
        for (let wy = base - h + 10; wy < base - 10; wy += 14) {
          for (let wx = x + 5; wx < x + w - 8; wx += 12) {
            if (rand() < 0.42) {
              g.fillStyle = ['#ffd9a0', '#9fe8ff', '#ff9fd0', '#fff3c0'][Math.floor(rand() * 4)];
              g.globalAlpha = 0.5 + rand() * 0.5;
              g.fillRect(wx, wy, 5, 7);
            }
          }
        }
        g.globalAlpha = 1;
        // A neon band or a sign on some of them.
        if (!far && rand() < 0.4) {
          g.fillStyle = ['#ff2c9c', '#2de2e6', '#ffd60a'][Math.floor(rand() * 3)];
          g.shadowColor = g.fillStyle as string;
          g.shadowBlur = 18;
          g.fillRect(x + 4, base - h + 8, w - 8, 10);
          g.shadowBlur = 0;
        }
        if (!far && rand() < 0.3) {
          g.fillStyle = '#ff2c9c';
          g.fillRect(x + w * 0.3, base - h - 26, w * 0.4, 18);
        }
        x += w + 8 + rand() * 40;
      }
    }
    // Haze along the street.
    const haze = g.createLinearGradient(0, 340, 0, 512);
    haze.addColorStop(0, 'rgba(120,40,140,0)');
    haze.addColorStop(1, 'rgba(160,60,150,0.5)');
    g.fillStyle = haze;
    g.fillRect(0, 340, 2048, 172);
  };
}


/** A tower face: rows of lit windows, for the boxes just outside the glass. */
export function towerFace(color: string, seed: number): THREE.CanvasTexture {
  return canvasTexture(256, 512, (g) => {
    const rand = seeded(seed);
    g.fillStyle = color;
    g.fillRect(0, 0, 256, 512);
    for (let y = 8; y < 500; y += 24) {
      for (let x = 8; x < 248; x += 20) {
        if (rand() < 0.34) {
          g.fillStyle = ['#ffd9a0', '#9fe8ff', '#ff9fd0'][Math.floor(rand() * 3)];
          g.globalAlpha = 0.35 + rand() * 0.6;
          g.fillRect(x, y, 10, 12);
        }
      }
    }
    g.globalAlpha = 1;
    g.strokeStyle = 'rgba(0,0,0,0.45)';
    g.lineWidth = 3;
    for (let y = 0; y < 512; y += 48) {
      g.beginPath();
      g.moveTo(0, y);
      g.lineTo(256, y);
      g.stroke();
    }
  });
}


/** A plasteel barrier's hazard face. */
export function hazard(color: string): THREE.CanvasTexture {
  return canvasTexture(256, 64, (g) => {
    g.fillStyle = '#1a1d24';
    g.fillRect(0, 0, 256, 64);
    g.fillStyle = color;
    for (let x = -64; x < 256; x += 48) {
      g.beginPath();
      g.moveTo(x, 64);
      g.lineTo(x + 24, 0);
      g.lineTo(x + 48, 0);
      g.lineTo(x + 24, 64);
      g.closePath();
      g.fill();
    }
    g.fillStyle = 'rgba(0,0,0,0.35)';
    g.fillRect(0, 28, 256, 8);
  });
}


/** A bright, unlit-looking material: the tower is emissive so it reads as a tube, not a painted strip. */
export function neonMat(color: string): THREE.MeshToonMaterial {
  const m = toonUnique(color);
  m.emissive.set(color);
  m.emissiveIntensity = 1.15;
  m.userData.outlineParameters = { visible: false };
  return m;
}


/** An unlit material for something that must not be dimmed by the night (a neon tube, a hologram). */
export function flat(color: string, opacity = 1): THREE.MeshBasicMaterial {
  const m = new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, toneMapped: false });
  m.userData.outlineParameters = { visible: false };
  return m;
}


/** A cylinder from `a` to `b` (a beam, a railing post, a neon tube). */
export function rod(a: THREE.Vector3, b: THREE.Vector3, r: number, mat: THREE.Material, shadow = false): THREE.Mesh {
  const along = b.clone().sub(a);
  const m = mesh(new THREE.CylinderGeometry(r, r, along.length(), 6), mat, (a.x + b.x) / 2, (a.y + b.y) / 2, (a.z + b.z) / 2, shadow);
  m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), along.normalize());
  return m;
}


/** A glowing tube between two points on the same plane: the plaza's neon. */
export function tube(parent: THREE.Object3D, ax: number, ay: number, az: number, bx: number, by: number, bz: number, r: number, mat: THREE.Material) {
  parent.add(rod(new THREE.Vector3(ax, ay, az), new THREE.Vector3(bx, by, bz), r, mat));
}


/** A neon light at (x, y, z) (in `parent`), while there are few enough of them. */
export function neonLight(kit: Kit, parent: THREE.Object3D, x: number, y: number, z: number, color: string, power: number) {
  if (kit.neons.length >= MAX_LIGHTS) return;
  const light = new THREE.PointLight(color, power, 20, 1.7);
  light.position.set(x, y, z);
  parent.add(light);
  kit.neons.push({ light, base: power, phase: Math.random() * 10, color: new THREE.Color(color) });
}


// ---- The props ------------------------------------------------------------------------------------

/** Puts a group at a prop's spot, turned its way: `y` up, or on whatever's underfoot there (the dais). */
export function placed(p: PropConfig, y = p.y ?? 0): THREE.Group {
  const g = new THREE.Group();
  g.position.set(p.x, y, p.z);
  g.rotation.y = p.rotY ?? 0;
  return g;
}


export function collide(kit: Kit, x: number, z: number, w: number, d: number, rotY: number, top: number, extra: Partial<Collider> = {}) {
  const [minX, maxX, minZ, maxZ] = boxFootprint(x, z, w, d, rotY);
  kit.colliders.push({ minX, maxX, minZ, maxZ, top, ...extra });
}


/** An ad board in a floor's color, with the project's name on it when it's the big one. */
export function paintAd(g: CanvasRenderingContext2D, w: number, h: number, color: string, name?: string) {
  g.fillStyle = '#0a0c12';
  g.fillRect(0, 0, w, h);
  g.fillStyle = color;
  g.fillRect(0, 0, w, h * 0.06);
  g.fillRect(0, h * 0.94, w, h * 0.06);
  g.font = `900 ${Math.floor(h * (name ? 0.6 : 0.42))}px Nunito, ui-rounded, system-ui, sans-serif`;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.shadowColor = color;
  g.shadowBlur = 26;
  g.fillStyle = color;
  g.fillText((name || 'NIGHT CITY').toUpperCase(), w / 2, h / 2);
  g.shadowBlur = 0;
  g.globalAlpha = 0.85;
  g.fillStyle = '#ffffff';
  g.fillText((name || 'NIGHT CITY').toUpperCase(), w / 2, h / 2);
  g.globalAlpha = 1;
}


/** A steel column, floor to ceiling, with an LED strip up its face and a hazard cuff at the foot. */
export function column(kit: Kit, p: PropConfig) {
  const s = p.scale ?? 1;
  const w = PROP_SIZE.pillar * s;
  const H = kit.height;
  const g = placed(p, 0);
  const { steel, steelDark } = kit.mats;
  g.add(mesh(box(w * 1.15, 0.5, w * 1.15), steelDark, 0, 0.25, 0));
  g.add(mesh(box(w, H - 1, w), steel, 0, 0.5 + (H - 1) / 2, 0));
  g.add(mesh(box(w * 1.2, 0.4, w * 1.2), steelDark, 0, H - 0.6, 0));
  g.add(mesh(box(w * 1.2, 0.4, w * 1.2), steelDark, 0, H - 0.2, 0));
  // An LED strip up the face and round the foot, in the floor's own color when it's the plaza's.
  const led = kit.mats.neon(kit.ledColor);
  for (const [dx, dz] of [
    [1, 0],
    [-1, 0],
    [0, 1],
    [0, -1],
  ]) {
    const strip = mesh(box(dx ? 0.06 : w * 0.7, H - 1.4, dz ? 0.06 : w * 0.7), led, dx * w * 0.54, 0.5 + (H - 1) / 2, dz * w * 0.54, false);
    g.add(strip);
  }
  kit.still.add(g);
  collide(kit, p.x, p.z, w * 1.2, w * 1.2, 0, 99);
}


/** A neon sign on a wall, with its tubes, its glow, and a shopfront under a wide one. */
export function neonSignProp(kit: Kit, p: PropConfig) {
  const w = p.width ?? 1.6;
  const h = p.height ?? 0.9;
  const y = p.y ?? 3.4;
  const color = p.color ?? '#ff2c9c';
  const g = placed(p);
  g.position.y = y;
  const { steelDark, neon } = kit.mats;
  // The board, its steel frame, and its glowing face.
  g.add(mesh(box(w + 0.16, h + 0.16, 0.1), steelDark, 0, -h / 2, 0));
  const face = new THREE.Mesh(new THREE.PlaneGeometry(w, h), flatMap(neonSign(signText(p, 'NEON'), color)));
  face.position.set(0, -h / 2, 0.06);
  g.add(face);
  // A tube round the board's edge, and one over its top.
  const tubeMat = neon(color);
  tube(g, -w / 2 - 0.1, -h - 0.1, 0.07, w / 2 + 0.1, -h - 0.1, 0.07, 0.028, tubeMat);
  tube(g, -w / 2 - 0.1, -h - 0.1, 0.07, -w / 2 - 0.1, 0.1, 0.07, 0.028, tubeMat);
  tube(g, w / 2 + 0.1, -h - 0.1, 0.07, w / 2 + 0.1, 0.1, 0.07, 0.028, tubeMat);
  const glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: glowTexture(), color, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  glow.material.userData.outlineParameters = { visible: false };
  glow.position.set(0, -h / 2, 0.18);
  glow.scale.set(w * 1.7, h * 2.4, 1);
  g.add(glow);
  if (p.light) neonLight(kit, g, 0, -h / 2, 0.6, color, 3.4);
  kit.group.add(g);
  floorGlow(kit, p.x, p.z, p.rotY ?? 0, w * 1.3, 5.5, color, 0.4);
  // A wide sign is a shop's: a doorway, its glow, and a canopy under it.
  if (w >= 2) shopfront(kit, p, color);
}


/** A shopfront under its sign: a recessed dark doorway with a lit interior and a small awning. */
export function shopfront(kit: Kit, p: PropConfig, color: string) {
  const g = placed(p, 0);
  const { steelDark, steel, dark } = kit.mats;
  const sw = SHOP_W;
  // The recess: side jambs, a lintel, a floor step, and a bright mouth.
  g.add(mesh(box(0.28, 3.4, 0.5), steelDark, -sw / 2, 1.7, 0.2));
  g.add(mesh(box(0.28, 3.4, 0.5), steelDark, sw / 2, 1.7, 0.2));
  g.add(mesh(box(sw + 0.3, 0.4, 0.5), steelDark, 0, 3.4, 0.2));
  g.add(mesh(box(sw + 0.5, 0.12, 0.9), steel, 0, 0.06, 0.35));
  const mouth = mesh(box(sw - 0.4, 3.1, 0.06), flat(shade(color, -0.2), 0.75), 0, 1.6, 0.42, false);
  g.add(mouth);
  // A strip of light down each jamb, and a canopy over the door.
  const led = kit.mats.neon(color);
  for (const sx of [-1, 1]) tube(g, sx * (sw / 2 - 0.16), 0.2, 0.45, sx * (sw / 2 - 0.16), 3.0, 0.45, 0.03, led);
  const canopy = mesh(box(sw + 0.6, 0.1, 0.9), steelDark, 0, 3.1, 0.6);
  canopy.rotation.x = 0.14;
  g.add(canopy);
  g.add(mesh(box(sw - 0.6, 0.05, 0.3), kit.mats.neon(color), 0, 3.03, 0.95, false));
  // A crate or two and a cone outside.
  g.add(mesh(box(0.5, 0.5, 0.5), dark, -sw / 2 - 0.35, 0.25, 0.5));
  g.add(mesh(new THREE.ConeGeometry(0.16, 0.5, 8), toon('#ff6b35'), sw / 2 + 0.4, 0.25, 0.5, false));
  kit.still.add(g);
  // (The wall behind it is not walked into, so nothing to collide with.)
}
