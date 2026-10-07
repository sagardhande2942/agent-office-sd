import type { Ctx } from '../../core/context';
import { HUD_ACTIONS } from '../../ui/menu';
import { h, openModal } from '../../ui/dom';

export type GraphicsMode = 'reduced' | 'enhanced';
const KEY = 'agent-office.2d-graphics';
export function loadGraphics(): GraphicsMode {
  try { return localStorage.getItem(KEY) === 'enhanced' ? 'enhanced' : 'reduced'; }
  catch { return 'reduced'; }
}
export function graphicsRatio(mode: GraphicsMode, deviceRatio: number) {
  const ratio = Number.isFinite(deviceRatio) && deviceRatio > 0 ? deviceRatio : 1;
  return mode === 'enhanced' ? Math.min(Math.max(ratio, 2), 3) : Math.min(ratio, 2);
}

/** Browser-local quality for the playable 2D view, registered by its existing module. */
export function configureGraphics(ctx: Ctx, exploring: () => boolean) {
  let mode = loadGraphics();
  let applied = '';
  const update = () => {
    const plan = exploring();
    ctx.renderer.shadowMap.enabled = !plan || mode === 'enhanced';
    const ratio = plan ? graphicsRatio(mode, window.devicePixelRatio) : Math.min(window.devicePixelRatio, 2);
    ctx.canvas.dataset.graphics = mode;
    const key = `${plan}:${ratio}`;
    if (key === applied) return;
    applied = key;
    ctx.renderer.setPixelRatio(ratio);
  };
  ctx.view.add({ update });
  HUD_ACTIONS.push({ id: 'plan-graphics', icon: '✨', label: '2D graphics settings', section: 'Office', status: () => true, chip: () => mode === 'enhanced' ? 'Enhanced' : 'Reduced', run: () => {
    const options = h('div.seg', { role: 'radiogroup', 'aria-label': '2D graphics quality' });
    const paint = () => options.replaceChildren(...(['reduced', 'enhanced'] as const).map(value => h('button.btn', {
      type: 'button', role: 'radio', 'aria-checked': String(mode === value), class: mode === value ? 'on' : '',
      onclick: () => {
        mode = value;
        try { localStorage.setItem(KEY, value); } catch { /* Still applies for this visit. */ }
        update(); paint();
      },
    }, value === 'reduced' ? 'Reduced (current)' : 'Enhanced')));
    paint();
    openModal(h('section.modal', { role: 'dialog', 'aria-label': '2D graphics settings' },
      h('header', {}, h('h2', {}, '2D graphics settings')),
      h('div.body', {}, options,
        h('p', {}, 'Reduced keeps the current rendering and leaves exploration shadows off. Enhanced renders at higher resolution with real-time shadows for furniture and characters.'),
        h('p', {}, 'Changes apply immediately and are saved in this browser. Enhanced uses more GPU power; choose Reduced if movement becomes slow.'))));
  } });
}
