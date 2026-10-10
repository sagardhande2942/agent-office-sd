import * as THREE from 'three';
import { model } from '../models';

const dressed = new WeakMap<THREE.Material, THREE.Material>();
/** Preserve the printed sleeve and clear neck when the surrounding fridge is painted in toon colors. */
export function bottleMaterial(source: THREE.Material): THREE.Material {
  if (!source.name.startsWith('DietCoke ') || !(source instanceof THREE.MeshStandardMaterial)) return source;
  let material = dressed.get(source);
  if (!material) {
    const copy = source.clone();
    if (source.name.includes('silver crown')) copy.metalness = 0.18;
    if (copy.transparent) copy.depthWrite = false;
    material = copy; dressed.set(source, material);
  }
  return material;
}

/** The same bottle for shelves, first-person hands, and everyone's avatar. Origin is its base. */
export function dietCokeBottle(scale = 1): THREE.Group {
  const group = new THREE.Group();
  group.name = 'diet_coke_bottle';
  const asset = model('diet-coke-bottle');
  if (asset) {
    asset.scene.traverse(object => {
      if (object instanceof THREE.Mesh) {
        object.material = Array.isArray(object.material) ? object.material.map(bottleMaterial) : bottleMaterial(object.material);
      }
    });
    group.add(asset.scene);
  } else {
    // Keep a recognizable drink even if the optional model failed to load.
    const profile = [[0,0],[.027,.004],[.030,.025],[.026,.075],[.026,.105],[.030,.14],[.025,.17],[.015,.195],[.014,.219]].map(([r,y]) => new THREE.Vector2(r,y));
    const amber = new THREE.MeshStandardMaterial({ color: '#6d2506', roughness: .2 });
    const body = new THREE.Mesh(new THREE.LatheGeometry(profile, 20), amber);
    const paper = new THREE.Mesh(new THREE.CylinderGeometry(.031,.026,.05,20,1,true), new THREE.MeshStandardMaterial({ color: '#f3f3ef' }));
    paper.position.y = .115;
    const cap = new THREE.Mesh(new THREE.CylinderGeometry(.018,.018,.009,21), new THREE.MeshStandardMaterial({ color: '#cdd2d8', metalness: .18 }));
    cap.position.y = .224;
    group.add(body, paper, cap);
  }
  group.scale.setScalar(scale);
  return group;
}
