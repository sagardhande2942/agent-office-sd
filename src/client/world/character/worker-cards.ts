import * as animation from './worker-fugdi';
import { BEAT as FUGDI_BEAT, FUGDI, FUGDI_SECONDS, fugdiPose } from '../../../shared/fugdi';
import * as THREE from 'three';
import type { Theme, WorkerAction, WorkerStatus, WorkerTask } from '../../../shared/protocol';
import { isAsleep, type WorkerPr } from '../../../shared/status';
import { beard, grime, peasantGarb, type Beard, type PeasantGarb } from '../costumes';
import { disposeSprite, mesh, textSprite, toon, toonUnique } from '../toon';
import type { WorkerRig } from './rig';
import { ease, popIn } from './curves';
import { undress } from './props';
import { ACT_MIN, DESPAIR_MIN, TWIRL_TIME, WAIT_CYCLE, WAIT_HOPS, blendStance, type Act, type Stance } from './worker-stance';
import { STATUS_BULB, bubbleFor } from './worker-badges';
import { globe, papers } from './worker-props';
import { DANCE, groove, type Dancing, type Stage } from './worker-dance';
import { DEAD, STARVED, bones, crossedEyes, slump } from './worker-jail';
import { packUp, waddle, type Leaving } from './worker-leave';
import { dressUp, growBeard, wearGarb } from './worker-dress';
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
