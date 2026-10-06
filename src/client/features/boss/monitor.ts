import * as THREE from 'three';
import { fmtCost, fmtTokens, type WorkerInfo } from '../../../shared/protocol';
import { byUrgency } from '../../nextup';
import { analytics } from './logic';

/** A read-only dashboard texture; switching to Minesweeper restores its original texture. */
export class BossMonitor {
  private readonly canvas = document.createElement('canvas');
  private readonly texture = new THREE.CanvasTexture(this.canvas);
  private readonly game: THREE.Texture | null;
  private readonly material: THREE.MeshBasicMaterial;

  constructor(screen: THREE.Mesh) {
    this.canvas.width = 960;
    this.canvas.height = 540;
    this.texture.colorSpace = THREE.SRGBColorSpace;
    this.material = screen.material as THREE.MeshBasicMaterial;
    this.game = this.material.map;
  }

  showGame(on: boolean) {
    this.material.map = on ? this.game : this.texture;
    this.material.color.set('#ffffff');
  }

  draw(workers: Iterable<WorkerInfo>) {
    const all = [...workers];
    const a = analytics(all);
    const color = a.needs ? '#ff5a76' : a.working ? '#42c8ff' : a.total && a.done === a.total ? '#7ddf8e' : '#ffd166';
    const g = this.canvas.getContext('2d')!;
    g.fillStyle = '#101827';
    g.fillRect(0, 0, 960, 540);
    g.strokeStyle = color;
    g.lineWidth = 8;
    g.strokeRect(8, 8, 944, 524);
    g.font = 'bold 32px system-ui';
    g.fillStyle = color;
    g.fillText('BOSS CONTROL CENTER', 40, 62);
    g.font = 'bold 23px system-ui';
    g.fillStyle = '#ffffff';
    g.fillText(`${a.total} workers   ${a.working} working   ${a.needs} need you   ${a.done} done`, 40, 110);
    g.fillText(`${fmtTokens(a.tokens)} tokens · ${fmtCost(a.cost)} reported`, 40, 150);
    byUrgency(all).slice(0, 5).forEach((w, i) => {
      g.fillStyle = w.status === 'needs_input' ? '#ff5a76' : '#bfe3ff';
      g.fillText(`${w.name.slice(0, 24)} · ${w.status}`, 40, 220 + i * 47);
    });
    g.font = '20px system-ui';
    g.fillStyle = '#aab6cc';
    g.fillText('Sit in the boss chair and press E · Minesweeper is still available', 40, 500);
    this.texture.needsUpdate = true;
  }
}
