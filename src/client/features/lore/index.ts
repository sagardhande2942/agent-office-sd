import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { knowledgeShelfNotes } from '../../../shared/lore';
import { store } from '../../state';
import { toast } from '../../ui/dom';
import { HUD_ACTIONS } from '../../ui/menu';
import { openLoreShelf } from './ui';

declare module '../../world/types' {
  interface InteractKinds {
    lore: true;
  }
}

export function installLore(ctx: Ctx) {
  function showLoreShelf(onUseInPrompt?: (text: string) => void) {
    if (!store.floor) return toast('Take the elevator to a floor first');
    openLoreShelf({ net: ctx.net, onUseInPrompt });
  }

  HUD_ACTIONS.push({
    id: 'lore',
    icon: '📜',
    label: 'Knowledge base',
    section: 'Office',
    title: () => 'Read and write reusable project knowledge, fixes, and gotchas',
    run: () => showLoreShelf(),
  });

  ctx.interactions.define('lore', {
    reach: 4,
    hint: () => {
      const count = knowledgeShelfNotes(store.lore).length;
      return {
        k: 'lore',
        parts: [
          hintTitle('📜 Lore Shelf'),
          aside(count ? `${count} note${count === 1 ? '' : 's'}` : 'empty shelf'),
          key('E', 'Open shelf'),
        ],
      };
    },
    use: onE(() => showLoreShelf()),
  });

  return { showLoreShelf };
}

