import * as THREE from 'three';
import { EXHALE_AT, SMOKE_CYCLE, dragCurve } from './curves';
import type { Person } from './person';
const v1 = new THREE.Vector3(), v2 = new THREE.Vector3();

export function smokeStep(ctx: Pick<Person,'smokeT'|'armL'|'ember'|'onSmoke'|'wispIn'|'root'|'cig'|'head'>, dt: number, walking: boolean, airborne: boolean) {
    const prev = ctx.smokeT % SMOKE_CYCLE;
    ctx.smokeT += dt;
    const c = ctx.smokeT % SMOKE_CYCLE;
    const k = walking || airborne ? 0 : dragCurve(c);
    if (!airborne) {
      ctx.armL.rotation.x = THREE.MathUtils.lerp(-0.9, -2.6, k);
      ctx.armL.rotation.z = THREE.MathUtils.lerp(0.15, 0.6, k);
    }
    const glow = k > 0.9 ? 1.4 : 0.3;
    ctx.ember.emissiveIntensity += (glow - ctx.ember.emissiveIntensity) * Math.min(1, dt * 6);
    if (!ctx.onSmoke) return;
    ctx.wispIn -= dt;
    const exhale = prev < EXHALE_AT && c >= EXHALE_AT;
    if (ctx.wispIn > 0 && !exhale) return;
    ctx.root.updateMatrixWorld(true);
    if (ctx.wispIn <= 0) {
      ctx.wispIn = 0.16 + Math.random() * 0.12;
      ctx.onSmoke('wisp', ctx.cig.localToWorld(v1.set(0, 0, 0.09)), v2.set(0, 1, 0));
    }
    if (exhale) {
      const dir = v2.set(0, 0.25, 1).applyQuaternion(ctx.root.quaternion).normalize();
      ctx.onSmoke('exhale', ctx.head.localToWorld(v1.set(0, -0.1, 0.36)), dir);
    }
  }
