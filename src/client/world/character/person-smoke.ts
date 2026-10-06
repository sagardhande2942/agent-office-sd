import { sodaCan } from './props';
import * as THREE from 'three';
import { HAIR_COLORS, HAIR_STYLES, SKIN_TONES, type Look } from '../../../shared/avatar';
import { EMOTE_BY_ID, type EmoteId } from '../../../shared/emotes';
import type { CarriedIssue, Theme } from '../../../shared/protocol';
import type { BarGame } from '../../../shared/bargames';
import type { Drink } from '../../../shared/rooftop';
import { HIPS, type PersonRig } from './rig';
import { axeModel, dartModel } from '../../features/bargames/world';
import { OpenBook } from '../../features/bookshelf/book';
import { HeldCard } from '../../features/carrying/card';
import { UNDEAD_SKIN } from '../costumes';
import { HolidayOutfit } from './person-outfit';
import { disposeSprite, mesh, textSprite, toon, toonUnique } from '../toon';
import { EXHALE_AT, REACH_TIME, SMOKE_CYCLE, dragCurve, reachCurve } from './curves';
import { cigarette, coffeeMug, drinkGlass, putDownGlass } from './props';
import { styleHair } from './person-hair';
import { clubSwing, strike, swingStep, type Golf } from './person-golf';
import { propPosition, throwStep, type Oche } from './person-throw';
import { poseEmote, type Emoting } from './person-emote';
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
