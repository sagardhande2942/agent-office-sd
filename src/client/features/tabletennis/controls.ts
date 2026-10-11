import * as THREE from 'three';
import type { PlayerController } from '../../player';
import { h } from '../../ui/dom';
import { PINGPONG_TABLE, PINGPONG_STROKES, shotTarget, type PingPongShotKind } from '../../../shared/tabletennis';
import type { TableTennisController } from './controller';
import './controls.css';

/** Aim is independent of footwork; one release produces exactly one charged stroke. */
export class TableTennisControls {
  private held?: { source: 'space' | 'mouse'; since: number; kind: PingPongShotKind };
  private meter = h('div.tt-power-fill');
  private label = h('strong');
  private bar = h('div.tt-power', { role: 'progressbar', 'aria-label': 'Shot power', 'aria-valuemin': 0, 'aria-valuemax': 100 }, this.meter);
  private hud = h('div.tt-shot-hud', {}, this.label, this.bar, h('div', {}, 'Mouse / arrows: aim · Hold Space / left click, release: shoot · WASD: feet'));
  private marker = new THREE.Mesh(new THREE.RingGeometry(0.065, 0.10, 32), new THREE.MeshBasicMaterial({ color: 0xffb64b, side: THREE.DoubleSide, transparent: true, opacity: 0.9, depthWrite: false }));
  constructor(private player: PlayerController, private controller: TableTennisController, scene: THREE.Scene) {
    document.body.append(this.hud); this.hud.hidden = true;
    this.marker.rotation.x = -Math.PI / 2; this.marker.visible = false; this.marker.name = 'tabletennis-shot-target'; scene.add(this.marker);
    window.addEventListener('keyup', e => { if (e.code === 'Space') this.release('space'); });
    window.addEventListener('pointerdown', e => {
      if (e.button === 0 && e.target instanceof HTMLCanvasElement) this.press('mouse', e.shiftKey ? 'smash' : e.ctrlKey ? 'backspin' : controller.stroke);
    });
    window.addEventListener('pointerup', e => { if (e.button === 0) this.release('mouse'); });
    window.addEventListener('blur', () => { this.held = undefined; });
    document.addEventListener('visibilitychange', () => { if (document.hidden) this.held = undefined; });
  }
  press(source: 'space' | 'mouse', kind: PingPongShotKind) {
    if (!this.controller.active || !this.player.enabled || this.held || this.controller.swinging) return;
    this.held = { source, since: performance.now(), kind };
  }
  private get power() { return this.held ? Math.min(1, 0.25 + (performance.now() - this.held.since) / 850 * 0.75) : 0.25; }
  private release(source: 'space' | 'mouse') {
    if (this.held?.source !== source) return;
    this.update(0);
    const { kind } = this.held, power = this.power; this.held = undefined;
    if (this.controller.active && this.player.enabled) this.controller.swing(kind, power);
  }
  update(dt: number) {
    const c = this.controller;
    this.hud.hidden = !c.active; this.marker.visible = c.active;
    if (!c.active) { this.held = undefined; return; }
    const dir = c.side === 'west' ? 1 : -1;
    const base = dir > 0 ? -Math.PI / 2 : Math.PI / 2;
    this.player.camYaw += ((this.player.holding('ArrowLeft') ? 1 : 0) - (this.player.holding('ArrowRight') ? 1 : 0)) * dt * 0.7;
    const offset = Math.atan2(Math.sin(this.player.camYaw - base), Math.cos(this.player.camYaw - base));
    this.player.camYaw = base + THREE.MathUtils.clamp(offset, -0.55, 0.55);
    this.player.lookPitch = THREE.MathUtils.clamp(this.player.lookPitch + ((this.player.holding('ArrowUp') ? 1 : 0) - (this.player.holding('ArrowDown') ? 1 : 0)) * dt * 0.4, -0.52, -0.12);
    c.aim = THREE.MathUtils.clamp(-dir * Math.tan(this.player.camYaw - base) / Math.tan(0.55), -1, 1);
    c.depth = THREE.MathUtils.clamp((this.player.lookPitch + 0.32) / 0.20, -1, 1);
    const target = shotTarget(c.side, c.aim, c.depth);
    this.marker.position.set(target.x, PINGPONG_TABLE.height + 0.006, target.z);
    const percent = Math.round(this.power * 100);
    this.label.textContent = `${PINGPONG_STROKES[this.held?.kind ?? c.stroke].label} · ${this.held ? 'Charging' : 'Ready'} ${percent}% · ${c.depth > 0.25 ? 'Deep' : c.depth < -0.25 ? 'Short' : 'Mid-table'}`;
    this.meter.style.width = `${percent}%`; this.bar.setAttribute('aria-valuenow', String(percent));
  }
}
