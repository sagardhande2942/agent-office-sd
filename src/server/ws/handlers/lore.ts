import type { LoreClientMsg } from '../../../shared/protocol.js';
import type { FloorActions as Floor } from '../../floor-actions.js';
import type { Ctx } from '../../office/context.js';
import { here } from './common.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const loreView: ViewPieces['lore'] = (_ctx, floor) => floor?.lore?.list() ?? [];

export const loreHandlers = {
  async 'lore.list'(ctx, c) {
    const floor = here(ctx, c);
    const notes = floor?.lore?.list() ?? [];
    ctx.sendTo(c, { t: 'lore.all', notes });
  },
  async 'lore.save'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor || !floor.lore) return;
    const title = msg.note.title?.trim();
    const content = msg.note.content?.trim();
    if (!title || !content) {
      return ctx.warn(c, 'Lore notes require a title and content.');
    }
    const note = floor.lore.save({
      ...msg.note,
      author: msg.note.author || c.peer.name,
    });
    ctx.toFloor(floor, { t: 'lore.saved', note });
    ctx.toastFloor(floor, `📜 ${c.peer.name} pinned a lore note: “${note.title}”`);
  },
  async 'lore.delete'(ctx, c, msg) {
    const floor = here(ctx, c);
    if (!floor || !floor.lore) return;
    const ok = floor.lore.delete(msg.id);
    if (ok) {
      ctx.toFloor(floor, { t: 'lore.deleted', id: msg.id });
    }
  },
} satisfies HandlerMap<LoreClientMsg>;
