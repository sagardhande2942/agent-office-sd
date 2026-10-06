// The whiteboard on every floor: who's drawing, and what they draw.
import { WebSocket } from 'ws';
import type { FloorActions as Floor } from '../../floor-actions.js';
import type { ServerMsg, WhiteboardClientMsg } from '../../../shared/protocol.js';
import type { Ctx } from '../../office/context.js';
import { throttle, type Client } from '../../office/client.js';
import { num } from '../../office/input.js';
import { here } from './common.js';
import type { FeatureHooks, HandlerMap, ViewPieces } from './types.js';

/** Everyone who has their floor's whiteboard open. */
const drawers = new WeakSet<Client>();

/** Who has a floor's whiteboard open. */
export const drawing = (ctx: Ctx, floor: Floor): string[] => [...ctx.clients.values()].filter((c) => drawers.has(c) && c.peer.floor === floor.id).map((c) => c.id);
export const whiteboardView: ViewPieces['whiteboard'] = (ctx, floor) => ({ elements: ctx.asLocal(floor)?.whiteboard.scene() ?? [], people: ctx.asLocal(floor) ? drawing(ctx, ctx.asLocal(floor)!) : [] });
export const drawingChanged = (ctx: Ctx, floor: Floor | undefined) => {
  if (floor) ctx.toFloor(floor, { t: 'wb.people', people: drawing(ctx, floor) });
};

/** Opening the whiteboard, or closing it. */
function openOrClose(ctx: Ctx, c: Client, msg: Extract<WhiteboardClientMsg, { t: 'wb.open' | 'wb.close' }>) {
  const floor = ctx.asLocal(ctx.floorOf(c));
  const open = msg.t === 'wb.open' && !!floor;
  if (open === drawers.has(c)) return;
  if (open) drawers.add(c);
  else drawers.delete(c);
  drawingChanged(ctx, floor);
}

export const whiteboardHandlers = {
  'wb.open': openOrClose,
  'wb.close': openOrClose,
  async 'wb.update'(ctx, c, msg) {
    const action = here(ctx, c);
    const floor = ctx.asLocal(action);
    if (action && !floor) return ctx.warn(c, action.refuses('the whiteboard'));
    if (!floor) return;
    const { accepted, error } = floor.whiteboard.apply(msg.elements);
    if (accepted.length) ctx.toNeighbors(c, { t: 'wb.update', elements: accepted });
    ctx.warn(c, error);
  },
  async 'wb.pointer'(ctx, c, msg) {
    if (!drawers.has(c) || !throttle(c, 'wb.pointer', 25)) return;
    const selected = Array.isArray(msg.selected) ? msg.selected.filter((s): s is string => typeof s === 'string').slice(0, 200).map((s) => s.slice(0, 100)) : undefined;
    const pointer: ServerMsg = { t: 'wb.pointer', id: c.id, x: num(msg.x), y: num(msg.y), tool: msg.tool === 'laser' ? 'laser' : 'pointer', button: msg.button === 'down' ? 'down' : 'up', selected };
    const json = JSON.stringify(pointer);
    for (const o of ctx.clients.values()) {
      if (o.id === c.id || !drawers.has(o) || o.peer.floor !== c.peer.floor || o.ws.readyState !== WebSocket.OPEN || o.ws.bufferedAmount > 1024 * 1024) continue;
      o.ws.send(json);
    }
  },
} satisfies HandlerMap<WhiteboardClientMsg>;

export const whiteboardHooks: FeatureHooks = {
  leaving(ctx, c, was) {
    // The whiteboard downstairs stays downstairs.
    const wasDrawing = drawers.has(c);
    drawers.delete(c);
    if (wasDrawing) return () => drawingChanged(ctx, ctx.asLocal(was));
  },
  closed(ctx, c) {
    if (drawers.has(c)) drawingChanged(ctx, ctx.asLocal(ctx.floorOf(c)));
  },
};
