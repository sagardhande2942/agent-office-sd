import * as THREE from 'three';
import { FICTIONAL_CHARACTERS, type FictionalCharacter } from '../../../shared/appearances';
import { createWorkerVisual, disposeWorkerVisual } from '../../world/character/appearance';
const portraits = new Map<FictionalCharacter, string>();
/** One short-lived renderer for the whole roster, rather than twenty WebGL contexts. */
export function characterPortraits() {
  if (portraits.size) return portraits;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setSize(180,180);renderer.setPixelRatio(1);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#d8e0e9');
  scene.add(new THREE.HemisphereLight('#ffffff','#63758c',.95));
  const light=new THREE.DirectionalLight('#ffffff',1.25);light.position.set(-2,4,5);scene.add(light);
  const camera=new THREE.PerspectiveCamera(33,1,.01,10);camera.position.set(1.1,1.25,2.5);camera.lookAt(0,.64,0);
  try {
    for(const [id] of FICTIONAL_CHARACTERS) {
      const v=createWorkerVisual(id);if(!v)continue;
      const root=new THREE.Group();root.add(v.body);
      v.arms.forEach((a,i)=>{const anchor=new THREE.Group();anchor.position.set(i?.3:-.3,.55,.05);anchor.add(a);root.add(anchor);});
      v.feet.forEach((f,i)=>{const anchor=new THREE.Group();anchor.position.set(i?.12:-.12,.2,.05);anchor.add(f);root.add(anchor);});
      scene.add(root);renderer.render(scene,camera);portraits.set(id,renderer.domElement.toDataURL());root.removeFromParent();disposeWorkerVisual(v);
    }
  } finally { renderer.dispose();renderer.forceContextLoss(); }
  return portraits;
}
