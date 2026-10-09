import { disposeSprite } from '../toon';
import { STATUS_BULB, bubbleFor } from './worker-badges';
import type { Worker } from './worker';

export function drawBubble(ctx: Pick<Worker,'status'|'bouncing'|'task'|'pr'|'lost'|'leaving'|'bubbleKey'|'bubble'|'root'|'bubbleIsCard'>, ) {
    if (ctx.leaving) return;
    const { status, bouncing: bounce, task, pr, lost } = ctx;
    const { key, draw } = bubbleFor(status, bounce, task, pr, lost);
    if (key === ctx.bubbleKey) return;
    ctx.bubbleKey = key;
    if (ctx.bubble) {
      ctx.root.remove(ctx.bubble);
      disposeSprite(ctx.bubble);
      ctx.bubble = null;
    }
    ctx.bubbleIsCard = !!task;
    ctx.bubble = draw();
    if (ctx.bubble) ctx.root.add(ctx.bubble);
  }

export function paintBulb(ctx: Pick<Worker,'status'|'bulb'>, ) {
    const c = STATUS_BULB[ctx.status] ?? '#adb5bd';
    ctx.bulb.color.set(c);
    ctx.bulb.emissive.set(c).multiplyScalar(0.7);
  }
