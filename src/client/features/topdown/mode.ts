import type { Ctx } from '../../core/context';
import { registerLiveView } from '../../shared/view-selector';
import { modalOpen, toast } from '../../ui/dom';
import { isTopdownRoute } from './camera';

/** Change projection in the existing scene, retaining the player and socket. */
export function installViewMode(ctx: Ctx, available: () => boolean) {
  let topdown = isTopdownRoute();
  let saved = { view: ctx.player.view, yaw: ctx.player.camYaw, pitch: ctx.player.lookPitch };
  const paint = () => document.body.classList.toggle('topdown', topdown);
  paint();
  const change = (path: string) => {
    if (path !== '/' && path !== '/2d') return false;
    const next = path === '/2d';
    if (next === topdown) return true;
    if (!available()) { toast('Finish the current activity before switching views', 'warn'); return true; }
    if (next) saved = { view: ctx.player.view, yaw: ctx.player.camYaw, pitch: ctx.player.lookPitch };
    topdown = next;
    paint();
    ctx.player.clearKeys();
    ctx.player.mouseLook = !topdown;
    if (topdown) ctx.player.unlock();
    else {
      ctx.player.view = saved.view;
      ctx.player.camYaw = saved.yaw;
      ctx.player.lookPitch = saved.pitch;
      ctx.player.updateCamera(true);
      if (!modalOpen() && ctx.player.canLock) ctx.player.lock();
    }
    const url = new URL(location.href);
    url.pathname = path;
    if (topdown) url.searchParams.delete('3d'); else url.searchParams.set('3d', '1');
    history.replaceState(history.state, '', url);
    ctx.hint.invalidate();
    return true;
  };
  registerLiveView(change);
  ctx.keys.bind({ code: 'KeyY', repeat: false, preventDefault: true, run: () => { change(topdown ? '/' : '/2d'); } });
  return () => topdown;
}
