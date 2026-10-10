import * as THREE from 'three';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { h, modalOpen, openModal, type Modal } from '../../ui/dom';
import { HUD_ACTIONS } from '../../ui/menu';
import { FLOOR } from '../../../shared/layout';
import { apply, snapshot, type Editable } from './model';
import { PlacementSave } from './persistence';
import './ui.css';
import { isTopdownRoute } from '../topdown/camera';

export function installObjectPlacement(ctx: Ctx) {
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2(), point = new THREE.Vector3();
  const offset = new THREE.Vector3(), plane = new THREE.Plane(), box = new THREE.Box3();
  const outline = new THREE.Box3Helper(box, 0xffd166);
  outline.visible = false; ctx.scene.add(outline);
  let entries: Editable[] = [], selected: Editable | null = null, modal: Modal | null = null;
  let scope = '', root: THREE.Object3D | null = null, pointer: number | null = null;
  let mode: 'move' | 'rotate' | 'scale' = 'move', startX = 0, startAngle = 0, startScale = 1;
  let snap = false;
  let cursorX = 0, cursorY = 0;
  const status = h('p', {}, 'Select a plant, rug or coffee table. Changes save automatically.');
  const controls = h('div.placement-controls');
  const validBounds = (e: Editable) => {
    box.setFromObject(e.object);
    return box.min.x >= FLOOR.minX + .15 && box.max.x <= FLOOR.maxX - .15 && box.min.z >= FLOOR.minZ + .15 && box.max.z <= FLOOR.maxZ - .15 && box.min.y >= -.05 && box.max.y <= 6.7;
  };
  const save = new PlacementSave(localStorage, () => { status.textContent = 'Saving failed. Browser storage may be full or blocked; changes will be retried.'; });
  const visible = (o: THREE.Object3D) => { for (let p: THREE.Object3D | null = o; p; p = p.parent) if (!p.visible) return false; return true; };
  function select(e: Editable | null) {
    save.flush(); selected = e; outline.visible = !!e; controls.hidden = !e;
    status.textContent = e ? `${e.label} · drag to ${mode}. Auto-save enabled.` : 'Select a plant, rug or coffee table. Changes save automatically.';
    if (e) { angle.value = String(e.object.rotation.y * 180 / Math.PI); size.value = String(e.object.scale.x / e.initial.scale[0]); box.setFromObject(e.object); }
  }
  function change(t = selected && snapshot(selected.object)) {
    if (!selected || !t) return;
    const old = snapshot(selected.object);
    apply(selected, t); box.setFromObject(selected.object);
    if (!validBounds(selected)) {
      apply(selected, old); box.setFromObject(selected.object);
      (outline.material as THREE.LineBasicMaterial).color.set(0xef476f); status.textContent = 'Keep the entire object inside the room.'; return;
    }
    (outline.material as THREE.LineBasicMaterial).color.set(0xffd166);
    save.queue(scope, selected.id, snapshot(selected.object));
    status.textContent = `${selected.label} · auto-saving`;
    angle.value = String(selected.object.rotation.y * 180 / Math.PI);
    size.value = String(selected.object.scale.x / selected.initial.scale[0]);
  }
  const button = (label: string, run: () => void) => h('button.btn', { type: 'button', onclick: run }, label);
  const angle = h('input', { type: 'number', step: '.1', 'aria-label': 'Rotation degrees' });
  const size = h('input', { type: 'number', min: '.25', max: '3', step: '.01', 'aria-label': 'Scale multiplier' });
  function rotate(degrees: number) {
    if (!selected || !Number.isFinite(degrees)) return;
    const t = snapshot(selected.object); t.rotation[1] = (snap ? Math.round(degrees / 15) * 15 : degrees) * Math.PI / 180; change(t);
  }
  function scale(value: number) {
    if (!selected || !Number.isFinite(value)) return;
    const t = snapshot(selected.object); t.scale = selected.initial.scale.map(n => n * Math.max(.25, Math.min(3, value))); change(t);
  }
  angle.addEventListener('input', () => rotate(angle.valueAsNumber));
  size.addEventListener('input', () => scale(size.valueAsNumber));
  for (const input of [angle, size]) input.addEventListener('change', () => save.flush());
  const snapInput = h('input', { type: 'checkbox' }); snapInput.onchange = () => { snap = snapInput.checked; };
  controls.append(
    ...(['move', 'rotate', 'scale'] as const).map(m => button(m[0].toUpperCase() + m.slice(1), () => { mode = m; select(selected); })),
    h('label', {}, 'Angle ° ', angle), h('label', {}, snapInput, ' Snap 15°'),
    button('Reset rotation', () => { if (selected) { const t = snapshot(selected.object); t.rotation = [...selected.initial.rotation]; change(t); save.flush(); } }),
    h('label', {}, 'Size × ', size), button('Original size', () => { scale(1); save.flush(); }),
    button('Reset Transform', () => { if (selected) change(structuredClone(selected.initial)); save.flush(); }),
    button('Confirm / Deselect', () => select(null)),
  );
  function end() {
    const previous = pointer;
    pointer = null;
    if (previous !== null && ctx.canvas.hasPointerCapture(previous)) ctx.canvas.releasePointerCapture(previous);
    if (save.flush() && selected) status.textContent = `${selected.label} · saved in this browser`;
  }
  function open() {
    if (modal || modalOpen() || !ctx.inOffice() || ctx.upTop() || ctx.trip()) return;
    ctx.activities.stopAll('start');
    const touchAction = ctx.canvas.style.touchAction; ctx.canvas.style.touchAction = 'none';
    const navigation = !isTopdownRoute();
    const panel = h('section.object-placement', { 'aria-label': 'Customize objects' }, h('header', {}, h('h2', {}, 'Customize objects')), status,
      navigation ? h('p', {}, 'WASD / arrows to walk · right-drag to look · left-drag to edit') : null, controls);
    panel.addEventListener('focusin', () => ctx.player.clearKeys());
    modal = openModal(panel, { allowMovement: navigation, backdropCloses: false, doing: 'customizing objects', onClose: () => { end(); select(null); modal = null; ctx.canvas.style.touchAction = touchAction; } });
    modal.backdrop.classList.add('placement-backdrop'); select(null);
  }
  HUD_ACTIONS.push({ id: 'object-placement', icon: '↔', label: 'Customize objects', section: 'Office', run: open,
    blocked: () => !ctx.inOffice() || ctx.upTop() ? 'Available on office floors' : undefined });
  function aim(x: number, y: number) {
    const r = ctx.canvas.getBoundingClientRect(); ndc.set((x - r.left) / r.width * 2 - 1, -(y - r.top) / r.height * 2 + 1);
    ray.setFromCamera(ndc, ctx.camera);
  }
  const editing = () => !!modal && modal.el.parentElement === document.getElementById('modal-root')?.lastElementChild;
  ctx.canvas.addEventListener('contextmenu', e => { if (editing()) e.preventDefault(); });
  ctx.canvas.addEventListener('pointerdown', e => {
    if (!editing()) return;
    if (pointer !== null) { e.preventDefault(); e.stopImmediatePropagation(); return; }
    if (e.button !== 0) return;
    e.preventDefault(); e.stopImmediatePropagation(); aim(e.clientX, e.clientY);
    ctx.canvas.focus({ preventScroll: true });
    const hit = ray.intersectObject(ctx.world().group, true).find(hit => {
      if (!visible(hit.object)) return false;
      const material = (hit.object as THREE.Mesh).material;
      const materials = Array.isArray(material) ? material : [material];
      return materials.some(m => m && m.visible && !(m.clippingPlanes ?? []).some(p => p.distanceToPoint(hit.point) < 0));
    });
    let entry: Editable | null = null;
    for (let o: THREE.Object3D | null = hit?.object ?? null; o; o = o.parent) if (o.userData.editable) { entry = o.userData.editable; break; }
    select(entry && entries.includes(entry) ? entry : null);
    if (!selected) return;
    selected.object.getWorldPosition(point); plane.setFromNormalAndCoplanarPoint(THREE.Object3D.DEFAULT_UP, point);
    if (!ray.ray.intersectPlane(plane, point)) return;
    offset.copy(selected.object.position).sub(selected.object.parent!.worldToLocal(point));
    pointer = e.pointerId; startX = e.clientX; startAngle = selected.object.rotation.y; startScale = selected.object.scale.x / selected.initial.scale[0];
    cursorX = e.clientX; cursorY = e.clientY;
    ctx.canvas.setPointerCapture(pointer);
  }, true);
  function moveObject() {
    if (!selected) return;
    aim(cursorX, cursorY); if (!ray.ray.intersectPlane(plane, point)) return;
    selected.object.parent!.worldToLocal(point).add(offset);
    if (Math.abs(selected.object.position.x - point.x) + Math.abs(selected.object.position.z - point.z) < 1e-8) return;
    const t = snapshot(selected.object); t.position[0] = point.x; t.position[2] = point.z; change(t);
  }
  ctx.canvas.addEventListener('pointermove', e => {
    if (e.pointerId !== pointer || !selected) return;
    if (!editing()) { end(); return; }
    e.preventDefault(); e.stopImmediatePropagation();
    if (mode === 'rotate') rotate((startAngle + (e.clientX - startX) * .01) * 180 / Math.PI);
    else if (mode === 'scale') scale(startScale * Math.exp((e.clientX - startX) * .005));
    else { cursorX = e.clientX; cursorY = e.clientY; moveObject(); }
  }, true);
  for (const event of ['pointerup', 'pointercancel', 'lostpointercapture']) ctx.canvas.addEventListener(event, () => { if (pointer !== null) end(); });
  window.addEventListener('pagehide', () => save.flush());
  window.addEventListener('blur', end);
  document.addEventListener('visibilitychange', () => { if (document.hidden) end(); });
  ctx.ticks.add('world', () => {
    const next = JSON.stringify([store.floor, ctx.plan().id]);
    if (scope !== next || root !== ctx.world().group) {
      end(); modal?.close(); scope = next; root = ctx.world().group; entries = [];
      root.traverse(o => { if (o.userData.editable) entries.push(o.userData.editable); });
      for (const e of entries) {
        apply(e, e.initial); const t = save.load(scope, e.id);
        if (t) {
          const factor = t.scale[0] / e.initial.scale[0];
          if (factor < .25 || factor > 3 || !t.scale.every((n, i) => Math.abs(n / e.initial.scale[i] - factor) < 1e-6)) continue;
          apply(e, t); if (!validBounds(e)) apply(e, e.initial);
        }
      }
      outline.visible = false;
    }
    if (modal && (ctx.trip() || ctx.upTop() || !ctx.inOffice())) modal.close();
    if (selected && !visible(selected.object)) { end(); select(null); }
    if (pointer !== null && !editing()) end();
    // Camera/player movement changes the world point even when the cursor stays still.
    if (pointer !== null && mode === 'move') moveObject();
  });
}
