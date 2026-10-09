import { originalBody } from './worker-body';
import { WorkerAppearance } from './appearance';
import type { WorkerAppearanceId } from '../../../shared/appearances';
import * as cards from './worker-cards';
import * as animation from './worker-fugdi';
const vScale = new THREE.Vector3();
const ease01 = (x: number) => ease(Math.min(1, Math.max(0, x)));
import * as THREE from 'three';
import type { Theme, WorkerAction, WorkerStatus, WorkerTask } from '../../../shared/protocol';
import { isAsleep, type WorkerPr } from '../../../shared/status';
import { beard, grime, peasantGarb, type Beard, type PeasantGarb } from '../costumes';
import { disposeSprite, textSprite } from '../toon';
import type { WorkerRig } from './rig';
import { ease, popIn } from './curves';
import { undress } from './props';
import { ACT_MIN, DESPAIR_MIN, TWIRL_TIME, WAIT_CYCLE, WAIT_HOPS, blendStance, type Act, type Stance } from './worker-stance';
import { STATUS_BULB } from './worker-badges';
import { globe, papers } from './worker-props';
import { DANCE, groove, type Dancing, type Stage } from './worker-dance';
import { DEAD, STARVED, bones, crossedEyes, slump } from './worker-jail';
import { packUp, waddle, type Leaving } from './worker-leave';
import { dressUp, growBeard, wearGarb } from './worker-dress';
/** The little Claude worker that sits at a desk. Forward is +z. */
export class Worker {
  /* internal animation state */ carriedLaptop: THREE.Object3D | null = null;
  /* internal animation state */ fugdiDance: { stage: Stage; ring: number; member: number; count: number; t: number } | null = null;
  carryLaptop(laptop: THREE.Object3D) { return animation.carryLaptop(this, laptop); }
  readonly root = new THREE.Group();
  /* internal animation state */ body = new THREE.Group();
  /** Its moving parts, for what poses them from the other files here (a dance, a cell, a costume). */
  private rig!: WorkerRig;
  private appearance: WorkerAppearance;
  private requestedTheme: Theme | null = null;
  private requestedOutfit: 'peasant' | null = null;
  /* internal animation state */ bulb!: THREE.MeshToonMaterial;
  /* internal animation state */ bulbMesh!: THREE.Mesh;
  /* internal animation state */ armL!: THREE.Object3D;
  /* internal animation state */ armR!: THREE.Object3D;
  /* internal animation state */ bubble: THREE.Sprite | null = null;
  /* internal animation state */ bubbleKey = '';
  /** The bubble is a task card: it hangs from its tail instead of floating. */
  /* internal animation state */ bubbleIsCard = false;
  /* internal card state */ task: WorkerTask | undefined;
  /** Its pull request, open or merged: its bubble is outlined (and labelled, while it rests) to match. */
  /* internal card state */ pr: WorkerPr | undefined;
  /** Its worktree was deleted outside the office (WorkerInfo.lost): its bubble says so until it's fixed. */
  /* internal card state */ lost = false;
  /* internal animation state */ nameTag: THREE.Sprite | null = null;
  private eyes: THREE.Mesh[] = [];
  private blinkAt = Math.random() * 4;
  status: WorkerStatus = 'starting';
  bouncing = false;
  /** You're close enough to read its card: it lands the hop it's in and stands still until you walk away. */
  held = false;
  /* internal animation state */ bounceT = 0;
  private spawnT = 0;
  /** Seconds left jumping for joy (its pull request just merged). */
  /* internal animation state */ cheerT = 0;
  /** Up on its desk dancing (a pull request merged): where, and how many seconds in. */
  /* internal animation state */ dancing: Dancing | null = null;
  /* internal animation state */ pupils: THREE.Object3D[] = [];
  /* internal animation state */ feet: THREE.Mesh[] = [];
  /** Sent home: the box of its things in its arms, and how far into its waddle it is. */
  /* internal animation state */ leaving: Leaving | null = null;
  /** On its way out (sent home) or in (called to a meeting): it waddles along instead of standing. */
  walking = false;
  /** What its latest tool call was (see setAction), and what it's acting out right now. */
  private nextAction: WorkerAction | undefined;
  private action: WorkerAction | undefined;
  private actionT = 0;
  /** How much of each act is in its stance right now, blending from one to the next. */
  private acts = new Map<Act, number>();
  private stance = {} as Stance;
  private blend = {} as Stance;
  /** Seconds it has been waiting on you, for the jump / tap-its-foot cycle. */
  private waitT = 0;
  private turnY = 0;
  /** Seconds into its finishing spin, or -1. */
  /* internal animation state */ twirlT = -1;
  private flipT = 0;
  /* internal animation state */ papers!: ReturnType<typeof papers>;
  /* internal animation state */ globe!: ReturnType<typeof globe>;
  /** Beside its laptop, where the globe floats (see setPropSpot). */
  private spot = new THREE.Vector3(-1, 1.1, 1.3);
  private skin!: THREE.MeshToonMaterial;
  /** Dressed up for a holiday (see setCostume), and what it's wearing. */
  private costume: Theme | null = null;
  private outfit: THREE.Object3D[] = [];
  /** Where it is in its own shamble, so a room full of zombies doesn't sway in step. */
  private phase = Math.random() * Math.PI * 2;
  /** How far through its stride it is, walking in. */
  private stride = 0;
  /** How quick its steps are, next to a walk: more running, less shuffling (see Court). */
  gait = 1;
  /** Its headset, which a peasant doesn't wear. */
  private headset: THREE.Object3D[] = [];
  /** What it wears on the map it's on (see setOutfit): a peasant's smock and coif, or its own skin. */
  private garb: PeasantGarb | null = null;
  /** How worn out it looks, 0–1 (see setAge), and the beard, brows and dirt that show it. */
  private age = 0;
  private whiskers: Beard | null = null;
  private dirt: { part: THREE.Object3D; at: number }[] = [];
  /** Locked up in a dungeon (see setJailed): how thin it's got, whether it's starved to death yet, and how far it has rotted since. */
  /* internal animation state */ jailed: { thin: number; dead: boolean; rot: number } | null = null;
  /** Which way it keeled over when it died, and what's left of it after: X for eyes, and its bones. */
  private fell = 1;
  private crosses: THREE.Object3D[] = [];
  private skeleton: THREE.Group | null = null;
  /** Something it's muttering in its cell, and for how many more seconds. */
  private mutterT = 0;
  private label = '';
  constructor(
    name: string,
    private color: string,
  ) {
    Object.assign(this, originalBody(this.root, this.body, color));
    this.appearance = new WorkerAppearance(this.rig, this.eyes);
    this.setName(name);
  }
  setAppearance(id: WorkerAppearanceId) {
    if (id === this.appearance.id || this.leaving) return;
    const theme = this.requestedTheme, outfit = this.requestedOutfit;
    if (this.appearance.id === 'original') { this.setCostume(null); this.setOutfit(null); }
    this.appearance.set(id);
    this.eyes = this.appearance.eyes;
    this.pupils = this.rig.pupils;
    this.requestedTheme = theme; this.requestedOutfit = outfit;
    if (id === 'original') { this.setCostume(theme); this.setOutfit(outfit); }
    this.setAge(this.age, true);
  }
  get appearanceId() { return this.appearance.id; }
  /** Where the globe floats, in its own space: beside its laptop, where the card over its head doesn't hide it. */
  setPropSpot(at: THREE.Vector3) {
    this.spot.copy(at);
  }
  /** What its latest tool call was, to act out while it's working. */
  setAction(action: WorkerAction | undefined) {
    this.nextAction = action;
  }
  /** Just finished: a quick spin and a hop. */
  celebrate() {
    this.twirlT = 0;
    this.cheer(1.2);
  }

  /** Dresses it up for a holiday (a zombie for Halloween, an elf for Christmas), or back in its own skin (null). */
  setCostume(theme: Theme | null) {
    this.requestedTheme = theme;
    if (this.appearance.id !== 'original') return;
    if (theme === this.costume) return;
    this.costume = theme;
    undress(this.outfit);
    dressUp(this.rig, theme, this.color, this.outfit);
    // An elf's hat goes on over the coif.
    if (this.garb) this.garb.cap.visible = theme !== 'christmas';
  }

  /**
   * Dresses it for the map it's on: a peasant's smock, rope belt and coif, in place of its headset,
   * or back in just its own skin (null).
   */
  setOutfit(outfit: 'peasant' | null) {
    this.requestedOutfit = outfit;
    if (this.appearance.id !== 'original') return;
    if (!!this.garb === (outfit === 'peasant')) return;
    if (this.garb) {
      undress([this.garb.body, this.garb.cap]);
      this.garb.cloth.dispose();
      this.garb = null;
    }
    if (outfit === 'peasant') {
      let seed = 0;
      for (const ch of this.color) seed = (seed * 31 + ch.charCodeAt(0)) | 0;
      this.garb = peasantGarb(seed);
      this.body.add(this.garb.body, this.garb.cap);
      this.garb.cap.visible = this.costume !== 'christmas';
    }
    for (const h of this.headset) h.visible = !this.garb;
    this.setAge(this.age, true);
  }

  /**
   * How worn out it looks, 0 (fresh) to 1 (it's worked for as long as the map says a worker can
   * before it's spent): its beard grows out and goes grey, it gets grubby and patched, it droops,
   * and it slows down.
   */
  setAge(k: number, force = false) {
    const age = Math.max(0, Math.min(1, k));
    if (!force && Math.abs(age - this.age) < 0.004) return;
    this.age = age;
    if (this.appearance.id !== 'original') {
      if (this.whiskers) this.whiskers.group.visible = false;
      for (const d of this.dirt) d.part.visible = false;
      return;
    }
    if (this.whiskers) this.whiskers.group.visible = true;
    if (age > 0.02 && !this.whiskers) {
      this.whiskers = beard();
      this.body.add(this.whiskers.group);
      this.dirt = grime();
      for (const d of this.dirt) this.body.add(d.part);
    }
    if (this.whiskers) growBeard(this.whiskers, age);
    for (const d of this.dirt) d.part.visible = age >= d.at;
    if (this.garb) wearGarb(this.garb, age);
  }

  /** How fast it walks, next to a fresh worker: a worn-out one shuffles. */
  get pace(): number {
    return 1 - 0.3 * this.age;
  }

  setName(name: string) {
    this.label = name;
    if (this.nameTag) {
      this.root.remove(this.nameTag);
      disposeSprite(this.nameTag);
    }
    this.nameTag = textSprite(name, { bg: '#2b2d42', color: '#fffaf3', size: 36, border: '#fffaf3' });
    this.nameTag.position.y = 1.55;
    this.root.add(this.nameTag);
  }

  setStatus(status: WorkerStatus, bounce: boolean) {
    this.status = status;
    this.bouncing = bounce;
    if (!this.dancing) this.paintBulb();
    this.drawBubble();
  }
  private paintBulb() { return cards.paintBulb(this, ); }


  /** Jumps for joy, arms up, for a few seconds. */
  cheer(seconds = 3) {
    this.cheerT = seconds;
  }

  /**
   * Hops up on to `stage` (its desk), dances for a few seconds with its light flashing like a disco
   * ball, and hops back down into its seat. Asked again mid-dance, it stays up and dances on.
   */
  dance(stage: Stage) {
    // Already in a Fugdi: let the ring finish rather than pull it out to its desk mid-dance.
    if (this.leaving || this.fugdiDance) return;
    const d = this.dancing;
    if (!d) {
      this.dancing = { stage, t: 0 };
      // The dance has a twirl of its own, so a finishing spin it cut into doesn't play after it.
      this.twirlT = -1;
    } else if (d.t > DANCE.up + DANCE.moves) {
      // On its way down: back up from wherever it is in the air.
      d.t = DANCE.up * (1 - (d.t - DANCE.up - DANCE.moves) / DANCE.down);
    } else d.t = Math.min(d.t, DANCE.up);
  }
  fugdi(stage: Stage, ring: number, member: number, count: number) { return animation.fugdi(this, stage, ring, member, count); }


  /** Back in its seat at once, mid-dance or not (it's being sent home). */
  stopDancing() {
    if (this.fugdiDance) {
      this.fugdiDance = null;
      this.settle();
      return;
    }
    if (!this.dancing) return;
    this.dancing = null;
    this.settle();
  }

  /** What it's working on, shown on a card over its head in place of the status bubble. */
  setTask(task: WorkerTask | undefined) {
    this.task = task;
    this.drawBubble();
  }

  setPr(pr: WorkerPr | undefined) {
    this.pr = pr;
    this.drawBubble();
  }

  setLost(lost: boolean) {
    this.lost = lost;
    this.drawBubble();
  }

  /** Sent home: its light goes out, its face falls, and its things pop into a box in its arms. `farewell` goes over its head. */
  leave(farewell: string) {
    if (this.leaving) return;
    this.setAppearance('original');
    this.bouncing = false;
    this.cheerT = 0;
    this.bounceT = 0;
    this.twirlT = -1;
    this.fugdiDance = null;
    for (const prop of [this.papers.group, this.globe.group]) prop.visible = false;
    this.armL.position.set(-0.3, 0.55, 0.05);
    this.armR.position.set(0.3, 0.55, 0.05);
    this.feet.forEach((f, i) => f.position.set(i ? 0.12 : -0.12, 0.2, 0.05));
    for (const p of this.pupils) p.position.y = 0.7;
    this.bulb.color.set(STATUS_BULB.exited);
    this.bulb.emissive.set('#000000');
    if (this.bubble) {
      this.root.remove(this.bubble);
      disposeSprite(this.bubble);
    }
    this.bubbleKey = 'leaving';
    this.bubbleIsCard = false;
    this.bubble = textSprite(farewell, { bg: '#e9ecef', size: 34 });
    this.root.add(this.bubble);
    this.leaving = { box: packUp(this.rig), boxT: 0, stride: 0 };
  }

  /** On its way out: says something else over its head in place of its farewell (or whatever was over it, before it packed up). */
  say(text: string) {
    if (this.bubble) {
      this.root.remove(this.bubble);
      disposeSprite(this.bubble);
    }
    this.bubbleKey = 'said';
    this.bubbleIsCard = false;
    this.bubble = textSprite(text, { bg: '#e9ecef', size: 34 });
    if (!this.leaving) this.bubble.position.y = 1.95;
    this.root.add(this.bubble);
  }
  private drawBubble() { return cards.drawBubble(this, ); }


  /**
   * Locked up in a dungeon for good (see shared/maps/dungeon.ts): sitting slumped on the floor of its
   * cell, thinner the longer it's been there (`thin`, 0–1), then dead, keeled over, then rotting down
   * to its bones (`rot`, 0–1). Its light's out, and nothing it was doing shows any more.
   */
  setJailed(k: { thin: number; dead: boolean; rot: number }) {
    const first = !this.jailed;
    const was = this.jailed;
    this.jailed = { ...k };
    if (first) {
      this.bouncing = false;
      this.cheerT = 0;
      this.twirlT = -1;
      this.dancing = null;
      this.fugdiDance = null;
      for (const prop of [this.papers.group, this.globe.group]) prop.visible = false;
      this.bulb.color.set(STATUS_BULB.exited);
      this.bulb.emissive.set('#000000');
      if (this.bubble) {
        this.root.remove(this.bubble);
        disposeSprite(this.bubble);
        this.bubble = null;
      }
      this.bubbleKey = 'jailed';
      this.fell = Math.random() < 0.5 ? -1 : 1;
    }
    // Pale and sallow as it starves, grey-green once it's dead, and darker as it rots.
    this.skin.color.set(this.color).lerp(STARVED, 0.55 * k.thin);
    if (k.dead) this.skin.color.lerp(DEAD, 0.55 + 0.35 * k.rot);
    if (k.dead && !this.crosses.length) this.crosses.push(...crossedEyes(this.body));
    for (const e of this.eyes) e.visible = !k.dead;
    for (const c of this.crosses) c.visible = k.dead;
    if (k.dead && k.rot > 0.2 && !this.skeleton) {
      this.skeleton = bones();
      this.root.add(this.skeleton);
    }
    const stage = !k.dead ? 0 : k.rot < 1 ? 1 : 2;
    const wasStage = !was ? -1 : !was.dead ? 0 : was.rot < 1 ? 1 : 2;
    if (stage !== wasStage) this.setName(this.label.replace(/^[☠💀]\uFE0F? /u, '').replace(/^/, stage === 1 ? '☠️ ' : stage === 2 ? '💀 ' : ''));
  }

  /** Mutters something in its cell (only while it's alive). */
  mutter(text: string, seconds = 4) {
    if (!this.jailed || this.jailed.dead) return;
    if (this.bubble) {
      this.root.remove(this.bubble);
      disposeSprite(this.bubble);
    }
    this.bubble = textSprite(text, { bg: '#e9ecef', size: 30 });
    this.bubble.position.y = 1.5;
    this.root.add(this.bubble);
    this.mutterT = seconds;
  }

  /** In its cell: slumped against the wall, breathing slow, or keeled over and rotting. */
  private languish(dt: number, t: number) {
    const { thin, dead } = this.jailed!;
    slump(this.rig, this.jailed!, this.skeleton, this.fell, this.phase, t);
    this.bulbMesh.scale.setScalar(1);
    this.blink(dt, dead ? 1 : 1 - 0.55 * thin);
    if (this.mutterT > 0) {
      this.mutterT -= dt;
      if (this.mutterT <= 0 && this.bubble) {
        this.root.remove(this.bubble);
        disposeSprite(this.bubble);
        this.bubble = null;
      }
    }
    if (this.nameTag) this.nameTag.position.y = dead ? 0.95 : 1.4;
  }

  update(dt: number, t: number) {
    if (this.jailed) return this.languish(dt, t);
    if (this.leaving) return this.carry(this.leaving, dt, t);
    if (this.fugdiDance) return this.fugdiStep(dt, t);
    if (this.dancing) return this.boogie(this.dancing, dt, t);
    this.cheerT = Math.max(0, this.cheerT - dt);
    // Waiting on you: a couple of seconds of jumping, then arms crossed and a tapping foot, and round again.
    this.waitT = this.status === 'needs_input' ? this.waitT + dt : 0;
    const tapping = this.status === 'needs_input' && (this.held || this.waitT % WAIT_CYCLE >= WAIT_HOPS);
    // Jump up and down when done / waiting on a human (except while held or tapping), or cheering.
    if (this.bouncing || this.cheerT > 0) {
      const landAt = Math.ceil(this.bounceT / Math.PI) * Math.PI;
      this.bounceT += dt * 7;
      if ((this.held || tapping) && !this.cheerT && this.bounceT >= landAt) this.bounceT = 0;
    } else this.bounceT = 0;
    const hopping = this.bounceT > 0;
    // Pop-in when hired
    this.spawnT = Math.min(1, this.spawnT + dt * 2.5);
    const pop = this.spawnT < 1 ? 1 + Math.sin(this.spawnT * Math.PI) * 0.35 : 1;

    this.actionT += dt;
    if (this.nextAction !== this.action && this.actionT >= (this.action === 'failing' ? DESPAIR_MIN : ACT_MIN)) {
      this.action = this.nextAction;
      this.actionT = 0;
    }
    const act: Act =
      hopping || (this.bouncing && this.status === 'done') ? 'up'
      : this.status === 'needs_input' ? 'waiting'
      : this.status === 'working' ? (this.carriedLaptop ? 'type' : (this.action ?? 'type'))
      : 'rest';
    const s = this.pose(act, dt, t);
    // A zombie at rest stands with its arms out in front of it, groping, listing to one side and swaying.
    const shamble = this.costume === 'halloween' ? Math.min(1, this.acts.get('rest') ?? 0) : 0;
    if (shamble > 0) {
      s.armLx += (-1.4 + Math.sin(t * 1.6 + this.phase) * 0.12 - s.armLx) * shamble;
      s.armRx += (-1.4 + Math.sin(t * 1.6 + this.phase + 1.3) * 0.12 - s.armRx) * shamble;
      s.roll += (0.09 + Math.sin(t * 1.1 + this.phase) * 0.05) * shamble;
    }

    this.armL.rotation.set(s.armLx, 0, s.armLz);
    this.armR.rotation.set(s.armRx, 0, s.armRz);
    this.armL.position.set(-0.3 + s.reach * 0.07, 0.55 - s.drop, 0.05 + s.reach * 0.12);
    this.armR.position.set(0.3 - s.reach * 0.07, 0.55 - s.drop + s.reach * 0.04, 0.05 + s.reach * 0.14);
    this.feet.forEach((f, i) => f.position.set(i ? 0.12 : -0.12, 0.2 + (i ? s.tap * 0.07 : 0), 0.05 + s.kick + (i ? s.tap * 0.03 : 0)));
    for (const p of this.pupils) p.position.y = 0.7 + s.look - 0.02 * this.age;
    // Worn out, it hunches over and its eyes droop.
    this.body.rotation.x = s.lean + 0.2 * this.age;
    s.lid = Math.min(s.lid, 1 - 0.38 * this.age);
    let twirl = 0;
    if (this.twirlT >= 0) {
      this.twirlT += dt;
      twirl = ease(Math.min(1, this.twirlT / TWIRL_TIME)) * Math.PI * 2;
      if (this.twirlT >= TWIRL_TIME) this.twirlT = -1;
    }
    if (hopping) {
      const h = Math.abs(Math.sin(this.bounceT));
      this.body.position.y = h * 0.55;
      const squash = h < 0.15 ? 1 - (0.15 - h) * 1.6 : 1;
      this.body.scale.set(pop * (2 - squash), pop * squash, pop * (2 - squash));
      this.turnY = Math.sin(this.bounceT * 0.5) * 0.3;
    } else {
      this.body.position.y = s.lift;
      this.body.scale.setScalar(pop);
      this.turnY += (s.turn - this.turnY) * Math.min(1, dt * 6);
    }
    this.body.rotation.y = this.turnY + twirl;
    this.body.rotation.z = isAsleep(this.status) ? Math.sin(t * 1.5) * 0.08 : s.roll;
    this.props(dt, t);
    if (this.carriedLaptop) {
      this.armL.position.set(-0.3, 0.55, 0.18);
      this.armR.position.set(0.3, 0.55, 0.18);
      this.armL.rotation.set(-1.15, 0, -0.12);
      this.armR.rotation.set(-1.15, 0, 0.12);
    }
    this.blink(dt, s.lid);
    this.bulbMesh.scale.setScalar(this.status === 'needs_input' ? 1 + Math.abs(Math.sin(t * 8)) * 0.5 : 1);
    if (this.bubble) this.bubble.position.y = (this.bubbleIsCard ? 1.74 : 1.95) + (hopping ? this.body.position.y : 0) + Math.sin(t * 3) * 0.03;
    if (this.nameTag) this.nameTag.position.y = 1.55 + (hopping ? this.body.position.y : 0);
    // Walking in to a meeting: the same waddle as on the way out, without the box.
    if (this.walking || this.stride) {
      this.stride = this.walking ? this.stride + dt * 9 * this.pace * this.gait : 0;
      const s = Math.sin(this.stride);
      this.feet.forEach((f, i) => {
        const step = i ? -s : s;
        f.position.z = 0.05 + step * 0.08;
        f.position.y = 0.2 + Math.max(0, step) * 0.05;
      });
      this.body.position.y += Math.abs(s) * 0.05;
      this.body.rotation.z = s * 0.1;
    }
  }

  /** Eases toward `act`'s stance, out of whatever it was doing before. */
  private pose(act: Act, dt: number, t: number): Stance {
    return blendStance(this.acts, act, dt, t, this.stance, this.blend);
  }

  /** The papers and the globe come and go with the act they belong to. */
  private props(dt: number, t: number) {
    const show = (prop: THREE.Object3D, act: Act) => {
      const w = this.acts.get(act) ?? 0;
      prop.visible = w > 0.02;
      if (prop.visible) prop.scale.setScalar(Math.max(0.001, popIn(w)));
      return prop.visible;
    };
    if (show(this.papers.group, 'read')) {
      // A page every second or so, flipped up and over the top.
      this.flipT = (this.flipT + dt) % 1.1;
      const f = Math.min(1, this.flipT / 0.45);
      this.papers.page.rotation.x = -ease(f) * Math.PI * 1.1;
      this.papers.page.visible = f < 1;
    }
    if (show(this.globe.group, 'web')) {
      this.globe.group.position.copy(this.spot).y += Math.sin(t * 2) * 0.03;
      this.globe.ball.rotation.y = t * 2.2;
      this.globe.ring.rotation.z = t * 0.6;
    }
  }

  /** Sent home: head hung, the box in its arms, waddling along while `walking`. */
  private carry(l: NonNullable<Worker['leaving']>, dt: number, t: number) {
    waddle(this.rig, l, this.walking, dt);
    this.blink(dt);
    if (this.bubble) this.bubble.position.y = 1.95 + Math.sin(t * 3) * 0.03;
    if (this.nameTag) this.nameTag.position.y = 1.55;
  }

  /** Up on the desk dancing: hop up, groove side to side, twirl, jump twice, hop back down. */
  private boogie(d: NonNullable<Worker['dancing']>, dt: number, t: number): void {
    d.t += dt;
    const { up, moves, down } = DANCE;
    if (d.t >= up + moves + down) {
      this.dancing = null;
      this.settle();
      return this.update(0, t);
    }
    const lift = groove(this.rig, d, dt, t);
    this.blink(dt);
    if (this.bubble) this.bubble.position.y = (this.bubbleIsCard ? 1.74 : 1.95) + lift + Math.sin(t * 3) * 0.03;
    if (this.nameTag) this.nameTag.position.y = 1.55 + lift;
  }
  private fugdiStep(dt: number, t: number): void { return animation.fugdiStep(this, dt, t); }


  /** Back in its seat, standing straight, its light showing its status again. */
  /* internal animation state */ settle() {
    this.root.position.set(0, 0, 0);
    this.root.rotation.set(0, 0, 0);
    this.body.position.set(0, 0, 0);
    this.body.rotation.set(0, 0, 0);
    this.body.scale.setScalar(1);
    for (const a of [this.armL, this.armR]) a.rotation.z = 0;
    for (const f of this.feet) f.position.set(f.position.x, 0.2, 0.05);
    this.bulbMesh.scale.setScalar(1);
    this.paintBulb();
  }

  /** `lid` narrows the eyes (1 = wide open) between blinks. */
  /* internal animation state */ blink(dt: number, lid = 1) {
    this.blinkAt -= dt;
    const blinking = this.blinkAt < 0.12 && this.blinkAt > 0;
    if (this.blinkAt < 0) this.blinkAt = 2 + Math.random() * 4;
    for (const e of this.eyes) e.scale.y = blinking ? 0.1 : lid;
  }

  dispose() {
    this.appearance.dispose();
    if (this.bubble) disposeSprite(this.bubble);
    if (this.nameTag) disposeSprite(this.nameTag);
    undress(this.crosses);
    if (this.skeleton) undress([this.skeleton]);
    undress(this.outfit);
    if (this.garb) {
      undress([this.garb.body, this.garb.cap]);
      this.garb.cloth.dispose();
    }
    if (this.whiskers) {
      undress([this.whiskers.group, ...this.dirt.map((d) => d.part)]);
      this.whiskers.hair.dispose();
    }
  }
}
