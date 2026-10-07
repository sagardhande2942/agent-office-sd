import * as THREE from 'three';
import { mesh, toon, toonUnique } from '../toon';
import { STATUS_BULB } from './worker-badges';
import { papers, globe } from './worker-props';
import type { WorkerRig } from './rig';
export function originalBody(root: THREE.Group, body: THREE.Group, color: string) {
  const parts = { root, body, skin: undefined as unknown as THREE.MeshToonMaterial, bulb: undefined as unknown as THREE.MeshToonMaterial,
    bulbMesh: undefined as unknown as THREE.Mesh, armL: undefined as unknown as THREE.Object3D, armR: undefined as unknown as THREE.Object3D,
    eyes: [] as THREE.Mesh[], pupils: [] as THREE.Object3D[], feet: [] as THREE.Mesh[], headset: [] as THREE.Object3D[],
    papers: undefined as unknown as ReturnType<typeof papers>, globe: undefined as unknown as ReturnType<typeof globe>, rig: undefined as unknown as WorkerRig };
    const skin = (parts.skin = toonUnique(color));
    const white = toon('#ffffff');
    const ink = toon('#1d1d1d');
    parts.root.add(parts.body);
    // Bean-shaped body
    const bean = mesh(new THREE.CapsuleGeometry(0.28, 0.3, 8, 16), skin, 0, 0.55, 0);
    parts.body.add(bean);
    // Big cartoon eyes
    for (const sx of [-1, 1]) {
      const eye = mesh(new THREE.SphereGeometry(0.09, 12, 10), white, sx * 0.11, 0.7, 0.23, false);
      eye.scale.z = 0.6;
      parts.body.add(eye);
      const pupil = mesh(new THREE.SphereGeometry(0.045, 10, 8), ink, sx * 0.11, 0.7, 0.29, false);
      parts.body.add(pupil);
      parts.eyes.push(eye, pupil);
      parts.pupils.push(pupil);
    }
    // Headset: band + mic
    const band = mesh(new THREE.TorusGeometry(0.29, 0.025, 6, 20, Math.PI), toon('#2b2d42'), 0, 0.72, 0, false);
    band.rotation.y = Math.PI / 2;
    parts.body.add(band);
    parts.headset.push(band);
    for (const sx of [-1, 1]) {
      const cup = mesh(new THREE.SphereGeometry(0.07, 10, 8), toon('#2b2d42'), sx * 0.29, 0.72, 0, false);
      parts.body.add(cup);
      parts.headset.push(cup);
    }
    // Antenna with status bulb
    parts.body.add(mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.22, 6), toon('#2b2d42'), 0, 1.07, 0, false));
    parts.bulb = toonUnique(STATUS_BULB.starting);
    parts.bulb.emissive = new THREE.Color(STATUS_BULB.starting).multiplyScalar(0.6);
    parts.bulbMesh = mesh(new THREE.SphereGeometry(0.075, 12, 10), parts.bulb, 0, 1.2, 0, false);
    parts.body.add(parts.bulbMesh);
    const arm = (x: number) => {
      const pivot = Object.assign(new THREE.Group(), { name: x < 0 ? 'armL' : 'armR' });
      pivot.position.set(x, 0.55, 0.05);
      pivot.add(mesh(new THREE.CapsuleGeometry(0.055, 0.16, 4, 8), skin, 0, -0.12, 0));
      parts.body.add(pivot);
      return pivot;
    };
    parts.armL = arm(-0.3);
    parts.armR = arm(0.3);
    for (const sx of [-1, 1]) {
      const foot = mesh(new THREE.CapsuleGeometry(0.06, 0.1, 4, 8), skin, sx * 0.12, 0.2, 0.05);
      parts.body.add(foot);
      parts.feet.push(foot);
    }
    // What it acts out with: papers in its hands, and a globe beside its laptop.
    parts.papers = papers();
    parts.papers.group.position.set(0, 0.86, 0.4);
    parts.papers.group.rotation.x = 0.35;
    parts.body.add(parts.papers.group);
    parts.globe = globe();
    for (const prop of [parts.papers.group, parts.globe.group]) prop.visible = false;
    parts.root.add(parts.globe.group);
    parts.rig = { root: parts.root, body: parts.body, skin: parts.skin, armL: parts.armL, armR: parts.armR, feet: parts.feet, pupils: parts.pupils, bulb: parts.bulb, bulbMesh: parts.bulbMesh, props: [parts.papers.group, parts.globe.group] };
  return parts;
}
