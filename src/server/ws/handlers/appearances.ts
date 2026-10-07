import type { AppearanceClientMsg } from '../../../shared/protocol.js';
import type { HandlerMap, ViewPieces } from './types.js';
export const appearanceView: ViewPieces['appearances'] = ctx => ctx.appearances.state();
export const appearanceHandlers = {
  'appearance.set'(ctx, client, msg) {
    if (!ctx.meOf(client.accountId).admin) return ctx.warn(client, 'Only admins can change worker appearances');
    ctx.warn(client, ctx.appearances.set(msg.config));
  },
} satisfies HandlerMap<AppearanceClientMsg>;
