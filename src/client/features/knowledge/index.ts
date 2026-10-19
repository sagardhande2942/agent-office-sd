import type { Ctx } from '../../core/context';
import { openKnowledge } from './ui';
let show: ((onUseInPrompt?: (text: string) => void) => void) | undefined;
/** The scene's shelf interaction remains lore; this module owns its knowledge window. */
export function installKnowledge(ctx: Ctx) {
  show = onUseInPrompt => openKnowledge({ net: ctx.net, onUseInPrompt });
  ctx.messages.on('floor.enter', () => ctx.net.send({ t: 'knowledge.tree' }));
}
export function openKnowledgeShelf(onUseInPrompt?: (text: string) => void) { show?.(onUseInPrompt); }
