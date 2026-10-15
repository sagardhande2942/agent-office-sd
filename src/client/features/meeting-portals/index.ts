import './style.css';
import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import { hintTitle, aside, key, onE } from '../../core/hint';
import { noOutline } from '../../core/outline';
import { store } from '../../state';
import { closeAllModals, modalOpen, toast } from '../../ui/dom';
import { HUD_ACTIONS } from '../../ui/menu';
import { MEETING_SPACE_NAVIGATION } from '../../ui/meeting-space-navigation';
import { MEETING_ROOM } from '../../../shared/layout';
import { spaceName, spaceStatus } from '../../../shared/meeting-spaces';
import { crossedRift, dialReality, realityColor, type RiftPoint } from './logic';
import { RealityPreview } from './preview';
import { RealityDoorway } from './world';
import { AnchorWindow } from './ui';
import { RealityTransition } from './transition';
import { realitySound } from './sound';

declare module '../../world/types' {
  interface InteractKinds {
    realityanchor: true;
    realityrift: true;
  }
}
export function installMeetingPortals(ctx: Ctx) {
  const preview = new RealityPreview(), doorway = new RealityDoorway(preview.target.texture), transition = new RealityTransition(ctx);
  ctx.scene.add(doorway.root); noOutline(doorway.root);
  let window: AnchorWindow | undefined, targetId = store.selectedMeetingSpace;
  let doorwayInstant = false;
  let previous: RiftPoint | undefined, lastRender = 0, lastCopy = 0, openedAt = 0;
  let pending: { name: string; ids: Set<string>; floor: string | null } | undefined;
  let lastFloor = store.floor, lastMap = ctx.plan().id;
  const spaces = () => store.meetingSpaces.spaces ?? [];
  const destination = () => spaces().find(s => s.id === targetId) ?? spaces().find(s => s.id === store.selectedMeetingSpace) ?? spaces()[0];
  const available = () => !!store.floor && !!spaces().length && !ctx.trip() && !ctx.upTop();
  const physical = () => available() && ctx.inOffice();
  const cue = (kind: 'open' | 'dial') => ctx.sound.recipe(a => realitySound(a, kind));
  function sync() {
    if (pending && pending.floor === store.floor) {
      const created = spaces().find(s => s.name === pending!.name && !pending!.ids.has(s.id));
      if (created) { targetId = created.id; pending = undefined; window?.created(); }
    }
    const target = destination();
    doorway.root.visible = physical();
    document.body.classList.toggle('reality-door-active', doorway.rift.visible && doorway.root.visible);
    if (!target) return;
    targetId = target.id;
    const attention = spaces().some(s => s.id !== store.selectedMeetingSpace && spaceStatus(s, store.workers.values()) === 'Needs attention');
    const shown = doorway.rift.visible ? target : spaces().find(s => s.id === store.selectedMeetingSpace) ?? target;
    doorway.labelAs(shown.name, doorway.rift.visible ? 'Walk through to enter · E to cross' : `REALITY ANCHOR${attention ? ' · Another meeting needs you' : ' · E to tune'}`, realityColor(shown.id), attention);
    preview.sync(target, store.workers, realityColor(target.id));
    window?.refresh(spaces(), target, store.selectedMeetingSpace, store.workers, physical());
  }
  function choose(id: string) {
    if (!spaces().some(s => s.id === id)) return;
    targetId = id; previous = undefined; cue('dial'); sync(); lastRender = 0;
  }
  function enter(instant = doorwayInstant) {
    const target = destination(); if (!target || !available()) return;
    transition.enter(target.id, instant, () => { doorway.rift.visible = false; previous = undefined; sync(); });
  }
  function openDoorway(instant: boolean) {
    const target = destination(); if (!target || target.id === store.selectedMeetingSpace || !physical()) return;
    doorwayInstant = instant; closeAllModals(); doorway.rift.visible = true; previous = undefined; openedAt = performance.now(); cue('open'); sync();
    toast(`Portal open to ${target.name}. Walk through the doorway beside the meeting-room entrance, or press E at the portal.`);
  }
  function openAnchor() {
    if (!available()) { toast('Enter a floor with meeting spaces first', 'warn'); return; }
    closeAllModals();
    if (!doorway.rift.visible) targetId = dialReality(spaces(), store.selectedMeetingSpace, 1) ?? store.selectedMeetingSpace;
    cue('open');
    window = new AnchorWindow({
      move: direction => { const id = dialReality(spaces(), targetId, direction); if (id) choose(id); }, choose, doorway: openDoorway, enter,
      create: name => {
        const clean = spaceName(name);
        if (!clean) { toast('Give the reality a name of 1–60 characters', 'warn'); return; }
        pending = { name: clean, ids: new Set(spaces().map(s => s.id)), floor: store.floor };
        ctx.net.send({ t: 'meeting-space.create', name: clean });
      },
      close: () => { window = undefined; pending = undefined; doorway.rift.visible = false; previous = undefined; sync(); },
    }, ctx.reduceMotion.matches);
    sync(); lastRender = 0;
  }
  MEETING_SPACE_NAVIGATION.open = openAnchor; MEETING_SPACE_NAVIGATION.label = 'Reality Anchor';
  HUD_ACTIONS.push({ id: 'meeting-realities', icon: '◉', label: 'Reality Anchor', section: 'Open', shown: available, title: () => 'Open a portal into another meeting reality', run: openAnchor });
  ctx.interactions.define('realityanchor', { reach: 3, hint: () => ({ k: targetId, parts: [hintTitle('Reality Anchor'), aside('same room · another reality'), key('E', 'Tune a destination')] }), use: onE(openAnchor) });
  ctx.interactions.define('realityrift', { reach: 3, hint: () => ({ k: targetId, parts: [hintTitle(destination()?.name ?? 'Meeting portal'), key('E', 'Cross into this reality')] }), use: onE(() => enter()) });
  ctx.keys.add('activity', event => {
    if (event.key !== 'Escape' || !doorway.rift.visible) return false;
    doorway.rift.visible = false; previous = undefined; sync(); return true;
  });
  ctx.usables.add({ usable: () => doorway.root.visible ? [doorway.anchor, ...(doorway.rift.visible ? [doorway.opening] : [])] : [], pickable: () => doorway.root });
  store.on('meeting', sync); store.on('workers', sync);
  function reset() {
    window?.modal.close(); transition.cancel(); pending = undefined; doorway.rift.visible = false; previous = undefined;
    targetId = store.selectedMeetingSpace; sync();
  }
  store.on('floor', () => { lastFloor = store.floor; reset(); });
  store.on('map', reset);
  doorway.place((MEETING_ROOM.door.x0 + MEETING_ROOM.door.x1) / 2, MEETING_ROOM.minZ - 1.25);
  ctx.ticks.add('others', ({ dt, t, now }) => {
    if (lastFloor !== store.floor || lastMap !== ctx.plan().id || ctx.trip() || ctx.upTop()) {
      lastFloor = store.floor; lastMap = ctx.plan().id;
      if (window || doorway.rift.visible || transition.active) reset();
    }
    doorway.root.visible = physical(); doorway.update(t, ctx.reduceMotion.matches);
    if (doorway.rift.visible && now - openedAt > 45000) { doorway.rift.visible = false; previous = undefined; sync(); }
    const point = doorway.local(ctx.player.pos);
    if (doorway.rift.visible && ctx.player.enabled && !modalOpen() && !transition.active && now - openedAt > 300) {
      if (ctx.player.moving && crossedRift(previous, point)) enter();
      previous = { x: point.x, y: point.y, z: point.z };
    } else previous = undefined;
    const visible = !!window || doorway.rift.visible && doorway.root.visible && ctx.player.pos.distanceTo(doorway.root.position) < 18;
    if (visible && !document.hidden && now - lastRender >= 120) {
      preview.render(ctx.renderer, Math.min((now - lastRender) / 1000, 0.2), ctx.reduceMotion.matches ? 0 : t); lastRender = now;
      if (window && now - lastCopy > 300) { preview.copy(ctx.renderer, window.canvas); lastCopy = now; }
    }
  });
  // Other viewers get a small presence ripple, never a space-selection command.
  const echoes = new Map<string, { mesh: THREE.Mesh; until: number }>();
  const echoGeometry = new THREE.RingGeometry(0.65, 0.7, 40), echoMaterial = new THREE.MeshBasicMaterial({ color: '#79e8ff', transparent: true, opacity: 0.5, side: THREE.DoubleSide, depthWrite: false });
  ctx.messages.on('peer.update', ({ peer }) => {
    if (peer.id === store.you || peer.floor !== store.floor || peer.doing !== 'crossing a meeting reality' || ctx.reduceMotion.matches) return;
    echoes.get(peer.id)?.mesh.removeFromParent();
    const mesh = new THREE.Mesh(echoGeometry, echoMaterial); mesh.position.set(peer.x, peer.y + 1.2, peer.z); ctx.scene.add(mesh); echoes.set(peer.id, { mesh, until: performance.now() + 700 });
  });
  ctx.ticks.add('others', ({ now }) => {
    for (const [id, echo] of echoes) { if (now >= echo.until || !store.peers.has(id) || store.peers.get(id)?.floor !== store.floor) { echo.mesh.removeFromParent(); echoes.delete(id); } else { echo.mesh.lookAt(ctx.camera.position); echo.mesh.scale.setScalar(1 + (1 - (echo.until - now) / 700) * 2); } }
  });
  globalThis.addEventListener('beforeunload', () => { reset(); doorway.dispose(); preview.dispose(); echoes.forEach(e => e.mesh.removeFromParent()); echoGeometry.dispose(); echoMaterial.dispose(); }, { once: true });
  sync();
}
