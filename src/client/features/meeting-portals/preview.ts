import * as THREE from 'three';
import { Worker } from '../../world/character';
import type { MeetingSpace } from '../../../shared/meeting-spaces';
import type { WorkerInfo } from '../../../shared/protocol';
import { MEETING_SEATS, MEETING_TABLE } from '../../../shared/layout';
/** A bounded view of the destination: the real character models and live meeting data, never new workers. */
export class RealityPreview {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(46, 0.8, 0.1, 30);
  readonly target = new THREE.WebGLRenderTarget(384, 480);
  private pixels = new Uint8Array(384 * 480 * 4);
  private frame = new ImageData(384, 480);
  private actors = new Map<string, Worker>();
  private owned: { dispose(): void }[] = [];
  private board = document.createElement('canvas');
  private texture = new THREE.CanvasTexture(this.board);
  private boardKey = '';
  private light = new THREE.PointLight('#79e8ff', 12, 12);
  constructor() {
    this.target.texture.colorSpace = THREE.SRGBColorSpace;
    this.scene.background = new THREE.Color('#10182d');
    this.scene.add(new THREE.HemisphereLight('#e1eeff', '#343149', 2.8));
    const sun = new THREE.DirectionalLight('#fff0da', 3); sun.position.set(-3, 6, -4); this.scene.add(sun);
    this.light.position.set(0, 3, 2); this.scene.add(this.light);
    this.camera.position.set(4.7, 3.6, -6.8); this.camera.lookAt(0, 1, 0.3);
    this.box(10, 0.12, 7, '#182239', 0, -0.08, 0);
    this.box(10, 3.6, 0.12, '#263550', 0, 1.75, 3.3);
    this.box(0.12, 3.6, 7, '#1e2a43', -4.9, 1.75, 0);
    this.box(4.2, 0.12, 1.7, '#b58b6d', 0, 0.76, 0);
    for (const x of [-1.4, 1.4]) this.box(0.2, 0.7, 0.8, '#293349', x, 0.35, 0);
    for (const def of MEETING_SEATS) {
      const x = def.x - MEETING_TABLE.x + Math.sin(def.rotY) * 0.85;
      const z = def.z - MEETING_TABLE.z + Math.cos(def.rotY) * 0.85;
      this.box(0.55, 0.12, 0.55, '#425879', x, 0.39, z);
      this.box(0.55, 0.55, 0.1, '#425879', x + Math.sin(def.rotY) * 0.25, 0.72, z + Math.cos(def.rotY) * 0.25);
      this.box(0.42, 0.05, 0.28, '#172539', def.x - MEETING_TABLE.x, 0.86, def.z - MEETING_TABLE.z);
    }
    this.board.width = 1024; this.board.height = 400;
    const geometry = new THREE.PlaneGeometry(4.8, 1.85), material = new THREE.MeshBasicMaterial({ map: this.texture });
    const screen = new THREE.Mesh(geometry, material); screen.position.set(0, 2.05, 3.21); screen.rotation.y = Math.PI;
    this.scene.add(screen); this.owned.push(geometry, material, this.texture);
  }
  private box(w: number, h: number, d: number, color: string, x: number, y: number, z: number) {
    const geometry = new THREE.BoxGeometry(w, h, d), material = new THREE.MeshStandardMaterial({ color, roughness: 0.8 });
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); this.scene.add(mesh); this.owned.push(geometry, material);
  }
  sync(space: MeetingSpace, workers: ReadonlyMap<string, WorkerInfo>, color: string) {
    this.light.color.set(color);
    const seats = space.current?.seats ?? [], ids = new Set(seats.map(s => s.workerId).filter(Boolean));
    for (const [id, actor] of this.actors) if (!ids.has(id)) { actor.root.removeFromParent(); actor.dispose(); this.actors.delete(id); }
    seats.forEach((seat, i) => {
      const info = seat.workerId && workers.get(seat.workerId); if (!info) return;
      let actor = this.actors.get(info.id);
      if (!actor) {
        actor = new Worker(info.name, info.color); this.actors.set(info.id, actor); this.scene.add(actor.root);
        const def = MEETING_SEATS[i];
        actor.root.position.set(def.x - MEETING_TABLE.x + Math.sin(def.rotY) * 0.85, 0.4, def.z - MEETING_TABLE.z + Math.cos(def.rotY) * 0.85);
        actor.root.rotation.y = def.rotY + Math.PI; actor.root.scale.setScalar(0.82);
      }
      actor.setStatus(info.status, false); actor.setAction(info.action);
    });
    const key = `${space.name}|${space.current?.preview ?? ''}|${space.current?.title ?? ''}|${space.current?.status ?? ''}|${color}`;
    if (key !== this.boardKey) {
      this.boardKey = key;
      const c = this.board.getContext('2d')!;
      c.fillStyle = '#0c1427'; c.fillRect(0, 0, 1024, 400); c.fillStyle = color; c.fillRect(0, 0, 1024, 8);
      c.font = 'bold 44px sans-serif'; c.fillText(space.name.slice(0, 34), 40, 75);
      c.fillStyle = '#e0e7f4'; c.font = '30px sans-serif'; c.fillText((space.current?.title ?? 'An unwritten reality').slice(0, 48), 40, 140);
      c.fillStyle = '#a3b6cd'; c.font = '26px sans-serif';
      const text = (space.current?.preview ?? (space.current ? 'Meeting in progress. Its output will appear here.' : 'An empty table. Your next meeting starts here.')).replace(/[#*`]/g, '').split(/\s+/);
      let line = '', row = 0;
      for (const word of text) { if ((line + word).length > 56) { c.fillText(line, 40, 220 + row++ * 42); line = ''; } if (row > 3) break; line += word + ' '; }
      if (row < 4) c.fillText(line, 40, 220 + row * 42);
      this.texture.needsUpdate = true;
    }
  }
  render(renderer: THREE.WebGLRenderer, dt: number, t: number) {
    for (const actor of this.actors.values()) actor.update(dt, t);
    const target = renderer.getRenderTarget(), viewport = renderer.getViewport(new THREE.Vector4()), scissor = renderer.getScissor(new THREE.Vector4());
    const scissorTest = renderer.getScissorTest(), autoClear = renderer.autoClear, xr = renderer.xr.enabled;
    try {
      renderer.xr.enabled = false; renderer.autoClear = true; renderer.setRenderTarget(this.target); renderer.setScissorTest(false);
      renderer.render(this.scene, this.camera);
    } finally {
      renderer.setRenderTarget(target); renderer.setViewport(viewport); renderer.setScissor(scissor); renderer.setScissorTest(scissorTest); renderer.autoClear = autoClear; renderer.xr.enabled = xr;
    }
  }
  copy(renderer: THREE.WebGLRenderer, canvas: HTMLCanvasElement) {
    const { width, height } = this.target;
    renderer.readRenderTargetPixels(this.target, 0, 0, width, height, this.pixels);
    for (let y = 0; y < height; y++) this.frame.data.set(this.pixels.subarray(y * width * 4, (y + 1) * width * 4), (height - y - 1) * width * 4);
    if (canvas.width !== width) { canvas.width = width; canvas.height = height; }
    canvas.getContext('2d')!.putImageData(this.frame, 0, 0);
  }
  dispose() { for (const actor of this.actors.values()) actor.dispose(); this.actors.clear(); this.target.dispose(); this.owned.forEach(item => item.dispose()); }
}
