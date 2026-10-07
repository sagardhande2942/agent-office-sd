import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { CoreState } from '../../core/ctx';
import type { Parts } from '../../core/parts';
import { modalOpen, h, openModal } from '../../ui/dom';
import { HUD_ACTIONS } from '../../ui/menu';
import { groundAt } from '../../player/collide';
import { PlanCamera } from './camera';
export { isTopdownRoute } from './camera';
import { store } from '../../state';
import { planClick } from './click';
import { cutaway } from './cutaway';
import { configureGraphics } from './graphics';
import './topdown.css';

/** Same office, every feature installed once; only exploration projection and pointing differ. */
export function installTopdown(ctx: Ctx, core: CoreState, parts: Parts) {
  const camera = ctx.camera;
  if (!(camera instanceof PlanCamera)) return;
  document.body.classList.add('topdown');
  const cut = new THREE.Plane(new THREE.Vector3(0, -1, 0), 2.5);
  ctx.renderer.localClippingEnabled = true;
  const clip = cutaway(ctx.scene, cut);
  const exploring = () => !ctx.activities.any('takesCamera') && !ctx.activities.running('driver') && !ctx.view.covered() && !parts.hanging.hanger.active && !parts.telescope.active;
  const zoom = (amount: number) => { camera.span = THREE.MathUtils.clamp(camera.span * amount, 12, 80); camera.updateProjectionMatrix(); };
  HUD_ACTIONS.push({ id: 'plan-camera', icon: '🧭', label: '2D view controls', section: 'Office', status: () => true, chip: () => '2D', run: () => {
    openModal(h('section.modal', {}, h('header', {}, h('h2', {}, '2D view controls')), h('div.body', {},
      h('p', {}, 'WASD / arrows to walk. Click the floor to walk there; click a fixture to approach and use it. E interacts nearby. Tab opens every office action. Use the elevator to change floors, visit the rooftop or garage, or add a project.'),
      h('p', {}, 'Scroll to zoom. Activities use their original camera and controls, then return to the top-down view.'),
      h('button.btn', { onclick: () => zoom(0.8) }, 'Zoom in'), ' ', h('button.btn', { onclick: () => zoom(1.25) }, 'Zoom out'), ' ',
      h('button.btn', { onclick: () => { camera.span = 30; camera.updateProjectionMatrix(); } }, 'Reset zoom'),
    )));
  } });
  ctx.canvas.addEventListener('wheel', e => {
    if (!exploring() || modalOpen()) return;
    e.preventDefault(); zoom(Math.exp(e.deltaY * 0.001));
  }, { passive: false });
  ctx.ticks.add('pre', () => {
    if (!exploring()) return;
    ctx.player.view = 'third'; ctx.player.camYaw = 0;
    ctx.player.mouseLook = false;
    if (ctx.player.locked) ctx.player.unlock();
  });
  ctx.view.add({ update: () => {
    const plan = exploring();
    camera.perspective = !plan;
    camera.updateProjectionMatrix();
    // Follow the supporting floor, not the airborne player's jump arc.
    const floorY = Math.max(groundAt(ctx.player.colliders, ctx.player.pos.x, ctx.player.pos.z, ctx.player.pos.y), ctx.player.street);
    cut.constant = plan ? floorY + 2.5 : 1e6;
    ctx.player.mouseLook = !plan;
    if (!plan) return;
    ctx.me.root.visible = true; // The plan camera never sits inside your character.
    const p = ctx.player.pos, room = ctx.player.room;
    const indoors = p.x > room.minX && p.x < room.maxX && p.z > room.minZ && p.z < room.maxZ;
    const clamp = (at: number, min: number, max: number, half: number) => max - min <= half * 2 ? (min + max) / 2 : THREE.MathUtils.clamp(at, min + half, max - half);
    const x = indoors ? clamp(p.x, room.minX, room.maxX, camera.span * camera.aspect / 2) : p.x;
    const z = indoors ? clamp(p.z, room.minZ, room.maxZ, camera.span * 0.55) : p.z;
    camera.position.set(x, floorY + 50, z + 24);
    camera.lookAt(x, floorY, z);
    camera.updateMatrixWorld();
  } });
  ctx.ticks.add('env', () => {
    clip();
    if (exploring() && ctx.scene.fog instanceof THREE.Fog) { ctx.scene.fog.near = 100; ctx.scene.fog.far = 200; }
  });
  configureGraphics(ctx, exploring);
  planClick(ctx, core, parts, exploring, () => cut.constant);
  // Browser diagnostics use the real registries and transport, never a second session.
  (window as any).__game2d = { ctx, core, parts, camera, exploring, store };
}
