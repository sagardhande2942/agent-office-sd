import type { Ctx } from '../../core/context';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { toast } from '../../ui/dom';
import { HUD_ACTIONS } from '../../ui/menu';
import { openKnowledgeShelf } from '../knowledge/index';

declare module '../../world/types' {
  interface InteractKinds {
    lore: true;
  }
}

export function installLore(ctx: Ctx) {
  function showLoreShelf(onUseInPrompt?: (text: string) => void) {
    if (!store.floor) return toast('Take the elevator to a floor first');
    openKnowledgeShelf(onUseInPrompt);
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
      const count = store.knowledge.rows.filter(n => !n.directory).length;
      return {
        k: 'lore',
        parts: [
          hintTitle('📜 Knowledge'),
          aside(count ? `${count} note${count === 1 ? '' : 's'}` : 'empty shelf'),
          key('E', 'Open shelf'),
        ],
      };
    },
    use: onE(() => showLoreShelf()),
  });

  return { showLoreShelf };
}

