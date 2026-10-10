import type { Ctx } from '../../core/context';
import { h, modalBlocksMovement } from '../../ui/dom';
import { choiceRow } from '../../ui/settings-rows';
import { registerSettingsExtension } from '../../ui/settings-extensions';
import { effectiveFps, FPS_OPTIONS, loadFps, saveFps, type Fps } from './preferences';

/** Browser-local frame pacing. Network messages and worker tasks do not use the scene loop. */
export function installPerformance(ctx: Ctx) {
  let fps = loadFps();
  let resumed = false;
  document.addEventListener('visibilitychange', () => {
    resumed = !document.hidden;
    if (document.hidden) ctx.player.clearKeys();
  });
  ctx.ticks.limit(() => {
    // Browsers may deliver no animation callbacks while hidden. Reset the clock on return too.
    if (resumed) { resumed = false; return null; }
    return effectiveFps(fps, document.hidden, modalBlocksMovement());
  });
  registerSettingsExtension({ pane: 'you', create: () => {
    const options = FPS_OPTIONS.map(value => [value, value === 'display' ? 'Match display' : `${value} FPS`] as const);
    const row = choiceRow<Fps>('Office FPS', options, () => fps, value => { fps = value; saveFps(value); });
    return { element: h('div.setting', {},
      h('div.setting-head', {}, h('h4', {}, 'Performance'), h('span.scope.you', {}, 'Just you')),
      row,
      h('p.setting-note', {}, 'Maximum frame rate for 3D and 2D Game. 60 FPS is the default; choose 30 to reduce power use. Match display follows your screen’s refresh rate. Actual FPS depends on your display and device.'),
      h('p.setting-note', {}, 'Scene updates pause in hidden tabs and run at up to 15 FPS while a window blocks movement. Workers and network updates continue. Changes apply immediately and are saved in this browser.')),
      dispose() {} };
  } });
}
