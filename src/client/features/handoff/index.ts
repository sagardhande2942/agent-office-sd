import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { openHandoffStation } from '../../shared/handoff/ui';
import { HUD_ACTIONS } from '../../ui/menu';

// The handoff station: the console on the floor and the office menu's window onto it, where a worker's
// finished-with-this-task packet is read before someone continues from it (see shared/handoff/).

// The kinds of thing you can use that this defines (see InteractKinds in world/types.ts).
declare module '../../world/types' {
  interface InteractKinds {
    handoffstation: true;
  }
}

/** The office's handoff station: a kiosk to walk up to, and a window that reads it. */
export function installHandoff(ctx: Ctx, parts: Pick<Parts, 'waiting'>) {
  const open = () => openHandoffStation((id) => parts.waiting.openWorkerTerminal(id));
  HUD_ACTIONS.push({
    id: 'handoffstation',
    icon: '🤝',
    label: 'Handoff station',
    section: 'Open',
    title: () => 'Task packets one worker offered another, and who accepted them',
    run: open,
  });
  ctx.interactions.define('handoffstation', {
    reach: 4.5,
    hint: () => ({ k: 'handoffstation', parts: [hintTitle('🤝 Handoff station'), aside('offers, acceptance and receipts'), key('E', 'Inspect handoffs')] }),
    use: onE(open),
  });
}
