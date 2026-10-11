import type { CodingAgentsClientMsg } from '../../../shared/protocol.js';
import type { HandlerMap, ViewPieces } from './types.js';

export const codingAgentsView: ViewPieces['codingAgents'] = (ctx) => ctx.codingAgents.state();

export const codingAgentsHandlers: HandlerMap<CodingAgentsClientMsg> = {
  'codingAgents.set'(ctx, client, msg) {
    if (!ctx.meOf(client.accountId).admin) {
      return ctx.warn(client, 'Only admins can change coding agent configuration');
    }
    const err = ctx.codingAgents.set(msg.config, client.peer.name);
    if (err) ctx.warn(client, err);
  },
  'codingAgents.reset'(ctx, client, _msg) {
    if (!ctx.meOf(client.accountId).admin) {
      return ctx.warn(client, 'Only admins can reset coding agent configuration');
    }
    ctx.codingAgents.reset(client.peer.name);
  },
};
