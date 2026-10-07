import * as THREE from 'three';

/** OutlineEffect copies local planes from source materials; global planes alone leave roof outlines. */
export function cutaway(scene: THREE.Scene, plane: THREE.Plane) {
  const seen = new WeakSet<THREE.Material>();
  return () => scene.traverse(object => {
    const material = (object as THREE.Mesh).material;
    if (!material) return;
    for (const mat of Array.isArray(material) ? material : [material]) {
      if (seen.has(mat)) continue;
      seen.add(mat);
      mat.clippingPlanes = [...(mat.clippingPlanes ?? []), plane];
      mat.needsUpdate = true;
    }
  });
}
