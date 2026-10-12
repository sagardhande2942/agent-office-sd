import type { KnowledgeClientMsg, KnowledgeTreeView } from '../../../shared/protocol/knowledge.js';
import { here } from './common.js';
import type { HandlerMap } from './types.js';
async function execute(ctx: Parameters<HandlerMap<KnowledgeClientMsg>['knowledge.tree']>[0], c: Parameters<HandlerMap<KnowledgeClientMsg>['knowledge.tree']>[1], msg: KnowledgeClientMsg) {
  const floor = here(ctx, c); if (!floor?.knowledge) return ctx.warn(c, 'Update this floor host to support knowledge');
  try {
    const result = await floor.knowledge.execute(msg, c.peer.name);
    if (msg.t === 'knowledge.tree') ctx.sendTo(c, { t: 'knowledge/tree', tree: result as KnowledgeTreeView });
    else if (msg.t === 'knowledge.read') ctx.sendTo(c, { t: 'knowledge/note', ...(result as { path: string; text: string }), handover: msg.handover });
    else if (msg.t === 'knowledge.search') ctx.sendTo(c, { t: 'knowledge/status', message: 'Search results', results: (result as { hits: never[] }).hits });
    else {
      ctx.sendTo(c, { t: 'knowledge/status', message: typeof (result as {message?: string}).message === 'string' ? (result as {message: string}).message : 'Knowledge updated' });
      ctx.toFloor(floor, { t: 'knowledge/tree', tree: await floor.knowledge.execute({ t: 'knowledge.tree' }, c.peer.name) as KnowledgeTreeView });
    }
  } catch (e) { ctx.warn(c, (e as Error).message); }
}
export const knowledgeHandlers = {
  'knowledge.tree': execute, 'knowledge.read': execute, 'knowledge.search': execute, 'knowledge.write': execute,
  'knowledge.commit': execute, 'knowledge.history': execute, 'knowledge.restore': execute, 'knowledge.delete': execute,
} satisfies HandlerMap<KnowledgeClientMsg>;
