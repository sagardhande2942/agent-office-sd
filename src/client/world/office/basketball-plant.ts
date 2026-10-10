import * as THREE from 'three';
import { model } from '../models';
import type { Fixture } from './fixture';

/** Replace only the west-wall plant beside the basketball; keep its existing collider. */
export const basketballPlant: Fixture = (site) => {
  const pot = site.get('plants').find((p) => p.position.x === -17.2 && p.position.z === 8.5);
  const loaded = model('basketball-plant');
  if (!pot || !loaded) return {};
  const custom = loaded.scene;

  const bounds = new THREE.Box3().setFromObject(custom);
  const size = bounds.getSize(new THREE.Vector3());
  if (bounds.isEmpty() || size.y <= 0) return {};
  // Fit the original 0.6 m footprint and keep the base on the floor, independent of export units.
  const scale = Math.min(1.5 / size.y, 0.6 / Math.max(size.x, size.z));
  const center = bounds.getCenter(new THREE.Vector3());
  const fitted = new THREE.Group();
  custom.position.sub(new THREE.Vector3(center.x, bounds.min.y, center.z));
  fitted.add(custom);
  fitted.scale.setScalar(scale);
  // The supplied asset combines pot and foliage: hide the whole model for the Christmas tree.
  fitted.name = 'basketball_plant_leaves';
  custom.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  pot.clear();
  pot.add(fitted);
  const mixer = new THREE.AnimationMixer(custom);
  for (const clip of loaded.clips) {
    mixer.clipAction(clip).setLoop(THREE.LoopRepeat, Infinity).play();
  }
  return { update: (_t, dt) => { if (fitted.visible) mixer.update(dt); } };
};
