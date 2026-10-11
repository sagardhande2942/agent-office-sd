import * as THREE from 'three';
import { textSprite, disposeSprite } from '../../world/toon';
import { PINGPONG_SPOTS, type PingPongState } from '../../../shared/tabletennis';
import type { PeerInfo } from '../../../shared/protocol';

/** A single name per seat, without creating duplicate people at the table. */
export class TableTennisNames {
  private labels = new Map<string, { name: string; sprite: THREE.Sprite; scale: THREE.Vector3 }>();
  private hidden = new Map<THREE.Object3D, boolean>();
  constructor(private scene: THREE.Scene, private peerBody?: (id: string) => THREE.Object3D | undefined) {}
  resize(camera: { position: THREE.Vector3; fov: number }) {
    for (const label of this.labels.values()) {
      const size = camera.position.distanceTo(label.sprite.position) * Math.tan(THREE.MathUtils.degToRad(camera.fov / 2)) * 0.16;
      label.sprite.scale.copy(label.scale).multiplyScalar(Math.min(1, size));
    }
  }
  update(state: PingPongState, peers: Map<string, PeerInfo>, you: string, local: THREE.Vector3) {
    const keepBodies = new Set<THREE.Object3D>(), keepLabels = new Set<string>();
    if (state.active) for (const side of ['west', 'east'] as const) {
      const player = side === 'west' ? state.westPlayer : state.eastPlayer;
      if (!player) continue;
      keepLabels.add(side);
      const root = player.isBot ? undefined : this.peerBody?.(player.id);
      if (root) { keepBodies.add(root); if (!this.hidden.has(root)) this.hidden.set(root, root.visible); root.visible = false; }
      let label = this.labels.get(side);
      if (label?.name !== player.name) {
        if (label) { this.scene.remove(label.sprite); disposeSprite(label.sprite); }
        const sprite = textSprite(player.name, { bg: '#fffaf3', size: 32 });
        sprite.name = `tabletennis-name-${side}`; this.scene.add(sprite);
        label = { name: player.name, sprite, scale: sprite.scale.clone() }; this.labels.set(side, label);
      }
      const peer = peers.get(player.id), spot = PINGPONG_SPOTS[side];
      const at = player.id === you ? local : root?.position ?? peer ?? spot;
      label.sprite.position.set(at.x, 1.6, at.z);
    }
    for (const [root, visible] of this.hidden) if (!keepBodies.has(root)) { root.visible = visible; this.hidden.delete(root); }
    for (const [side, label] of this.labels) if (!keepLabels.has(side)) { this.scene.remove(label.sprite); disposeSprite(label.sprite); this.labels.delete(side); }
  }
}
