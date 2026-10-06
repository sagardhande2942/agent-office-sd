import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { store } from '../../state';
import { HUD_ACTIONS } from '../../ui/menu';
import { openCommunications } from '../../ui/communications';

export function installCommunications(_ctx: Ctx, parts: Pick<Parts, 'waiting' | 'hud'>) {
  HUD_ACTIONS.push({
    id: 'communications', icon: '📬', label: 'Worker communications', section: 'Open',
    count: () => store.communications.messages.filter(m => m.kind === 'request' && !['completed', 'expired'].includes(m.status)).length,
    run: () => openCommunications(id => parts.waiting.openWorkerTerminal(id)),
  });
  store.on('communications', () => parts.hud.hud.refresh());
}
