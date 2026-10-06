import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { HUD_ACTIONS } from '../../ui/menu';
import { openPlanReview } from '../../ui/plan-review';
import { PALETTE_ENTRIES } from '../palette';
declare module '../../world/types' { interface InteractKinds {
    planreview: true;
    planseat: true;
  } }
export function installPlanReview(ctx: Ctx, parts: Pick<Parts, 'waiting'>) {
  const open = () => openPlanReview(ctx.net, id => parts.waiting.openWorkerTerminal(id));
  HUD_ACTIONS.push({ id: 'planreview', icon: '📐', label: 'Compare plans', section: 'Open', title: () => 'Independent plans, scored by a reviewer', run: open });
  PALETTE_ENTRIES.push(() => [{ icon: '📐', kind: 'Action', title: 'Plan comparison', keywords: ['compare plans', 'review plans'], open }]);
  ctx.interactions.define('planreview', { reach: 7, hint: () => ({ k: store.planReview.current?.phase ?? 'free', parts: [hintTitle('Plan comparison table'), aside(store.planReview.current?.phase ?? 'free'), key('E', 'Compare plans')] }), use: onE(open) });
  ctx.interactions.define('planseat', {
    reach: 4.5,
    hint: it => store.workerAtDesk(it.deskId ?? '') ? ctx.interactions.hint({ ...it, kind: 'desk' }) : { k: 'planreview', parts: [hintTitle('Plan comparison seat · free'), key('E', 'Compare plans')] },
    use: (it, button, note) => { if (store.workerAtDesk(it.deskId ?? '')) ctx.interactions.use({ ...it, kind: 'desk' }, button, note); else if (button === 'E') open(); },
  });
}
