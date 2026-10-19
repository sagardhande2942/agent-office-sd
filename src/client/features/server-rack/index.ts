import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { aside, hintTitle, key, onE } from '../../core/hint';
import { store } from '../../state';
import { HUD_ACTIONS } from '../../ui/menu';
import { PALETTE_ENTRIES } from '../palette';
import { rackHintSummary } from '../../shared/server-rack/format';
import { openServerRack } from '../../shared/server-rack/ui';

declare module '../../world/types' {
  interface InteractKinds {
    serverrack: true;
  }
}

export function installServerRack(ctx: Ctx, parts: Pick<Parts, 'waiting' | 'walking'>) {
  const open = () => {
    openServerRack(ctx.net, (id) => parts.waiting.openWorkerTerminal(id));
  };

  HUD_ACTIONS.push({
    id: 'serverrack',
    icon: '🗄️',
    label: 'Server rack',
    section: 'Open',
    count: () => store.services.items.length,
    title: () => 'Machine CPU/RAM telemetry and active worker dev servers',
    run: open,
  });

  PALETTE_ENTRIES.push(() => {
    const it = ctx.office.interactables.find((x) => x.kind === 'serverrack' && !x.off);
    return [
      {
        icon: '🗄️',
        kind: 'Board',
        title: 'Server rack',
        detail: rackHintSummary(store.machine, store.services.items.length),
        keywords: ['machine', 'cpu', 'memory', 'ram', 'ports', 'dev servers', 'blades'],
        open,
        walk: it ? () => parts.walking.walkThen(it, 'the server rack', open) : undefined,
      },
    ];
  });

  ctx.ticks.add('world', ({ t }) => {
    ctx.office.serverRack.update(t, store.machine, store.services.items.length, ctx.reduceMotion.matches);
  });

  ctx.interactions.define('serverrack', {
    reach: 4,
    hint: () => {
      const summary = rackHintSummary(store.machine, store.services.items.length);
      return {
        k: summary,
        parts: [hintTitle('🗄️ Server rack'), aside(summary), key('E', 'Inspect rack')],
      };
    },
    use: onE(open),
  });
}
