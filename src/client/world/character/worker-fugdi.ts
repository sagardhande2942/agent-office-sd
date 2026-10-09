import { BEAT as FUGDI_BEAT, FUGDI, FUGDI_SECONDS, fugdiPose } from '../../../shared/fugdi';
import * as THREE from 'three';
import { ease } from './curves';
import { type Stage } from './worker-dance';
import type { Worker } from './worker';
const vScale = new THREE.Vector3();
const ease01 = (x:number) => ease(Math.min(1,Math.max(0,x)));

export function fugdi(ctx: Pick<Worker,'leaving'|'jailed'|'fugdiDance'|'dancing'|'twirlT'|'cheerT'|'bounceT'>, stage: Stage, ring: number, member: number, count: number) {
    if (ctx.leaving || ctx.jailed) return;
    if (ctx.fugdiDance) {
      Object.assign(ctx.fugdiDance, { stage, ring, member, count });
      return;
    }
    ctx.dancing = null;
    ctx.twirlT = -1;
    ctx.cheerT = 0;
    ctx.bounceT = 0;
    ctx.fugdiDance = { stage, ring, member, count, t: -FUGDI.gather };
  }

export function fugdiStep(ctx: Pick<Worker,'fugdiDance'|'settle'|'update'|'root'|'armL'|'armR'|'pupils'|'papers'|'globe'|'body'|'feet'|'bulb'|'bulbMesh'|'blink'|'bubble'|'bubbleIsCard'|'nameTag'>, dt: number, t: number): void {
    const f = ctx.fugdiDance!;
    f.t += dt;
    if (f.t >= FUGDI_SECONDS + FUGDI.leave) {
      ctx.fugdiDance = null;
      ctx.settle();
      return ctx.update(0, t);
    }
    const { stage } = f;
    // Setting off (t below 0) and going back at the end ease in and out of the seat.
    const inK = ease01((f.t + FUGDI.gather) / FUGDI.gather);
    const outK = ease01((f.t - FUGDI_SECONDS) / FUGDI.leave);
    const k = inK * (1 - outK);
    const pose = fugdiPose(f.t, f.member, f.count, f.ring);
    // The ring's middle and its footing are in the seat's own frame, which may be turned and scaled.
    const turn = stage.yaw;
    const cos = Math.cos(turn);
    const sin = Math.sin(turn);
    const scale = ctx.root.parent ? ctx.root.parent.getWorldScale(vScale).x || 1 : 1;
    const ox = (pose.dx * cos + pose.dz * sin) / scale;
    const oz = (-pose.dx * sin + pose.dz * cos) / scale;
    ctx.root.position.set((stage.pos.x + ox) * k, stage.pos.y * k, (stage.pos.z + oz) * k);
    ctx.root.rotation.y = (turn + pose.yaw) * k;
    // Whatever it was acting out waits: shoulders back in place, eyes ahead, the papers and globe put away.
    ctx.armL.position.set(-0.3, 0.55, 0.05);
    ctx.armR.position.set(0.3, 0.55, 0.05);
    for (const p of ctx.pupils) p.position.y = 0.7;
    for (const prop of [ctx.papers.group, ctx.globe.group]) prop.visible = false;
    // Arms: clapping in front of the chest, rising overhead for the finale.
    const up = pose.armsUp * k;
    const armX = -1.2 - 1.5 * up;
    const armZ = ((0.28 + 0.44 * pose.clap) * (1 - up) + (0.1 + 0.16 * pose.clap) * up) * k;
    const soft = 1 - Math.exp(-dt * 16);
    ctx.armL.rotation.x += (armX - ctx.armL.rotation.x) * soft;
    ctx.armR.rotation.x += (armX - ctx.armR.rotation.x) * soft;
    ctx.armL.rotation.z += (armZ - ctx.armL.rotation.z) * soft;
    ctx.armR.rotation.z += (-armZ - ctx.armR.rotation.z) * soft;
    // The whirl goes on the body, so the name tag stays put; the ring's own turn is on the root.
    ctx.body.position.set(0, pose.lift * k, 0);
    ctx.body.rotation.set(0, pose.spin * k, pose.sway * k);
    ctx.body.scale.setScalar(1);
    const step = pose.step * k;
    ctx.feet.forEach((foot, i) => {
      const lift = Math.max(0, i ? -step : step);
      foot.position.set(i ? 0.12 : -0.12, 0.2 + lift * 0.09, 0.05);
    });
    // Its light keeps the beat: a color a beat, brighter on each clap.
    const hue = (((f.ring * 0.37 + Math.floor(Math.max(0, f.t) / FUGDI_BEAT) * 0.21) % 1) + 1) % 1;
    ctx.bulb.color.setHSL(hue, 0.85, 0.45 + 0.18 * pose.clap);
    ctx.bulb.emissive.copy(ctx.bulb.color).multiplyScalar(0.55);
    ctx.bulbMesh.scale.setScalar(1 + pose.clap * 0.3);
    ctx.blink(dt);
    const lift = pose.lift * k;
    if (ctx.bubble) ctx.bubble.position.y = (ctx.bubbleIsCard ? 1.74 : 1.95) + lift + Math.sin(t * 3) * 0.03;
    if (ctx.nameTag) ctx.nameTag.position.y = 1.55 + lift;
  }

export function carryLaptop(ctx: Pick<Worker,'carriedLaptop'|'body'>, laptop: THREE.Object3D) {
    ctx.carriedLaptop = laptop;
    laptop.position.set(0, 0.48, 0.48);
    laptop.rotation.y = Math.PI;
    laptop.scale.setScalar(0.85);
    ctx.body.add(laptop);
  }
