import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import type { CoreState } from '../../core/ctx';
import type { Parts } from '../../core/parts';
import type { Interactable } from '../../world/types';
import { modalOpen, toast } from '../../ui/dom';
import { wayTo } from '../walking/walkto';
import { store } from '../../state';

/** Projects the actual scene and uses the existing interaction and walking policies. */
export function planClick(ctx: Ctx, core: CoreState, parts: Parts, exploring: () => boolean, cut: () => number) {
  const ordinaryClick = ctx.player.onClick;
  const ray = new THREE.Raycaster(), projected = new THREE.Vector3();
  const shown = (object: THREE.Object3D) => {
    for (let o: THREE.Object3D | null = object; o; o = o.parent) if (!o.visible) return false;
    return true;
  };
  ctx.player.onClick = ndc => {
    if (!exploring() || core.carrying || parts.hanging.hanger.active || parts.hoops.holding() || parts.emotes.emoteWheel.isOpen) return ordinaryClick?.(ndc);
    if (modalOpen() || core.trip || !ctx.player.enabled) return;
    ray.setFromCamera(ndc, ctx.camera);
    const hits = ray.intersectObjects(ctx.scene.children, true).filter(hit => shown(hit.object) && hit.point.y <= cut() + 0.01);
    let picked: Interactable | undefined;
    const hit = hits.find(hit => {
      for (let o: THREE.Object3D | null = hit.object; o; o = o.parent) {
        const it = o.userData.interact as Interactable | undefined;
        if (it && !it.off) { picked = it; return true; }
      }
      // The first visible surface stops the ray; a floor still allows projected fixture targets.
      return true;
    });
    // Narrow vertical boards and doors remain easy to select from above.
    if (!picked) {
      let distance = 24;
      for (const it of parts.pointer.usable().flat()) {
        if (it.off || Math.abs((it.y ?? 0) - ctx.player.pos.y) > 1.5) continue;
        projected.set(it.x, (it.y ?? 0) + 0.7, it.z).project(ctx.camera);
        const d = Math.hypot((projected.x - ndc.x) * innerWidth / 2, (projected.y - ndc.y) * innerHeight / 2);
        if (d < distance) { distance = d; picked = it; }
      }
    }
    if (picked) {
      const it = picked;
      const w = it.deskId && store.workerAtDesk(it.deskId);
      if (w) return parts.waiting.openWorkerTerminal(w.id);
      const use = () => parts.pointer.use(it, 'E');
      if (Math.hypot(it.x - ctx.player.pos.x, it.z - ctx.player.pos.z) <= it.radius) return void use();
      return parts.walking.walkThen({ x: it.x, y: it.y, z: it.z }, it.kind, use, it);
    }
    if (!hit) return;
    if (ctx.player.seat) parts.seating.standUp();
    parts.walking.stopWalkingTo();
    const at = hit.point;
    const route = ctx.upTop() ? [{ x: at.x, z: at.z }] : ctx.inOffice() ? wayTo(ctx.player.pos, at, parts.worlds.officeWing()) : ctx.world().nav.route([ctx.player.pos.x, ctx.player.pos.z], [at.x, at.z]).slice(1).map(([x, z]) => ({ x, z }));
    if (!route.length) return toast('No walkable route to that spot', 'warn');
    ctx.player.walkPath(route);
  };
}
