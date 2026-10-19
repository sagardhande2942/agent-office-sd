import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { openHandoffStation } from '../../shared/handoff/ui';
import { HUD_ACTIONS } from '../../ui/menu';
import { PALETTE_ENTRIES } from '../palette';

// The handoff station: the office menu and command palette window onto durable task handoff packets,
// where a worker's unfinished-task packet is read before someone continues from it (see shared/handoff/).

/** The office's handoff station: opened from the office menu or command palette. */
export function installHandoff(_ctx: Ctx, parts: Pick<Parts, 'waiting'>) {
  const open = () => openHandoffStation((id) => parts.waiting.openWorkerTerminal(id));
  HUD_ACTIONS.push({
    id: 'handoffstation',
    icon: '🤝',
    label: 'Handoff station',
    section: 'Spaces',
    title: () => 'Task packets one worker offered another, and who accepted them',
    run: open,
  });
  PALETTE_ENTRIES.push(() => [
    {
      icon: '🤝',
      kind: 'Board',
      title: 'Handoff station',
      detail: 'offers, acceptance and receipts',
      keywords: ['handoff', 'packets', 'transfer', 'continuation'],
      open,
    },
  ]);
}
