import * as THREE from 'three';
import type { Interactable } from '../../world/types';
const vertex = `varying vec2 vUv; void main(){vUv=uv; gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`;
/** The doorway owns its meshes; its destination texture is a separate scene, never a recursive office render. */
export class RealityDoorway {
  readonly root = new THREE.Group();
  readonly rift = new THREE.Group();
  readonly anchor: Interactable = { kind: 'realityanchor', x: 0, z: 0, radius: 1.3 };
  readonly opening: Interactable = { kind: 'realityrift', x: 0, z: 0, radius: 1.3 };
  private uniforms = { time: { value: 0 }, tint: { value: new THREE.Color('#79e8ff') }, image: { value: null as THREE.Texture | null } };
  private label = document.createElement('canvas');
  private labelTexture = new THREE.CanvasTexture(this.label);
  private labelKey = '';
  private halo: THREE.Mesh;
  private spill = new THREE.Mesh(new THREE.CircleGeometry(2, 48), new THREE.MeshBasicMaterial({ color: '#79e8ff', transparent: true, opacity: 0.08, depthWrite: false, blending: THREE.AdditiveBlending }));
  private owned: { dispose(): void }[] = [];
  constructor(texture: THREE.Texture) {
    this.root.name = 'meeting-reality-anchor'; this.rift.name = 'meeting-reality-doorway';
    this.uniforms.image.value = texture;
    const ringMaterial = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vertex, transparent: true, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending,
      fragmentShader: `varying vec2 vUv; uniform float time; uniform vec3 tint;
      void main(){vec2 p=(vUv-.5)*2.;float a=atan(p.y,p.x);float r=length(p);float jag=sin(a*23.+time*2.)*.012+sin(a*41.-time)*.009;
      float edge=abs(r-(.91+jag));float energy=exp(-edge*65.)+exp(-edge*15.)*.32;
      float arc=.65+.35*sin(a*9.-time*3.); gl_FragColor=vec4(tint*energy*1.8,clamp(energy*arc,0.,1.));}` });
    const geometry = new THREE.PlaneGeometry(2.7, 3.4), ring = new THREE.Mesh(geometry, ringMaterial); ring.position.y = 1.5; ring.renderOrder = 2;
    const openingGeometry = new THREE.CircleGeometry(1, 80), openingMaterial = new THREE.ShaderMaterial({ uniforms: this.uniforms, vertexShader: vertex, side: THREE.DoubleSide,
      fragmentShader: `varying vec2 vUv; uniform sampler2D image;uniform float time;uniform vec3 tint;
      void main(){vec2 facingUv=gl_FrontFacing?vUv:vec2(1.-vUv.x,vUv.y);vec2 p=facingUv-.5;float r=length(p)*2.;vec2 uv=facingUv+normalize(p+vec2(.001))*sin(r*22.-time*2.)*.004*r*r;
      vec3 c=texture2D(image,uv).rgb;float edge=smoothstep(.72,1.,r);gl_FragColor=vec4(mix(c,tint*.7,edge*.32),1.);
#include <tonemapping_fragment>
#include <colorspace_fragment>
}` });
    const opening = new THREE.Mesh(openingGeometry, openingMaterial); opening.scale.set(1.14, 1.45, 1); opening.position.set(0, 1.5, -0.01); opening.userData.interact = this.opening;
    this.rift.add(opening, ring); this.spill.position.set(0, 0.02, 0); this.spill.rotation.x = -Math.PI / 2; this.owned.push(this.spill.geometry, this.spill.material); this.root.add(this.rift, this.spill); this.rift.visible = false;
    this.owned.push(geometry, ringMaterial, openingGeometry, openingMaterial);
    const metal = new THREE.MeshStandardMaterial({ color: '#1c263e', metalness: 0.8, roughness: 0.28 });
    const baseGeometry = new THREE.CylinderGeometry(0.36, 0.55, 0.18, 8), base = new THREE.Mesh(baseGeometry, metal); base.position.set(1.7, 0.09, 0);
    const stemGeometry = new THREE.CylinderGeometry(0.12, 0.2, 0.9, 8), stem = new THREE.Mesh(stemGeometry, metal); stem.position.set(1.7, 0.6, 0);
    const dialGeometry = new THREE.TorusGeometry(0.29, 0.055, 8, 32), glow = new THREE.MeshBasicMaterial({ color: '#79e8ff' });
    this.halo = new THREE.Mesh(dialGeometry, glow); this.halo.position.set(1.7, 1.25, 0); this.halo.rotation.x = -0.4;
    for (const object of [base, stem, this.halo]) { object.userData.interact = this.anchor; this.root.add(object); }
    this.owned.push(baseGeometry, stemGeometry, metal, dialGeometry, glow);
    const positions = new Float32Array(96 * 3);
    for (let i = 0; i < 96; i++) { const a = i / 96 * Math.PI * 2, r = 1.02 + (i % 7) * 0.025; positions.set([Math.cos(a) * r * 1.14, 1.5 + Math.sin(a) * r * 1.45, (i % 5) * 0.014], i * 3); }
    const sparksGeometry = new THREE.BufferGeometry(); sparksGeometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    const sparksMaterial = new THREE.PointsMaterial({ color: '#d9faff', size: 0.025, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
    this.rift.add(new THREE.Points(sparksGeometry, sparksMaterial)); this.owned.push(sparksGeometry, sparksMaterial);
    this.label.width = 768; this.label.height = 160;
    const labelGeometry = new THREE.PlaneGeometry(2.65, 0.55), labelMaterial = new THREE.MeshBasicMaterial({ map: this.labelTexture, transparent: true, side: THREE.DoubleSide });
    const plaque = new THREE.Mesh(labelGeometry, labelMaterial); plaque.position.set(0, 3.2, 0); this.root.add(plaque);
    this.owned.push(labelGeometry, labelMaterial, this.labelTexture);
  }
  place(x: number, z: number, yaw = 0) {
    this.root.position.set(x, 0, z); this.root.rotation.y = yaw; this.root.updateMatrixWorld(true);
    const at = this.root.localToWorld(new THREE.Vector3(1.7, 0, 0)); this.anchor.x = at.x; this.anchor.z = at.z;
    this.opening.x = x; this.opening.z = z;
  }
  labelAs(name: string, detail: string, color: string, attention: boolean) {
    this.uniforms.tint.value.set(color); this.spill.material.color.set(color);
    (this.halo.material as THREE.MeshBasicMaterial).color.set(attention ? '#ffbd7a' : color);
    const key = name + detail + color;
    if (key === this.labelKey) return; this.labelKey = key;
    const c = this.label.getContext('2d')!; c.clearRect(0, 0, 768, 160); c.fillStyle = '#0c1427ee'; c.fillRect(0, 0, 768, 160);
    c.fillStyle = color; c.font = 'bold 40px sans-serif'; c.textAlign = 'center'; c.fillText(name.slice(0, 32), 384, 65);
    c.fillStyle = '#d4e1f1'; c.font = '25px sans-serif'; c.fillText(detail.slice(0, 52), 384, 116); this.labelTexture.needsUpdate = true;
  }
  update(t: number, reduced: boolean) { this.uniforms.time.value = reduced ? 0 : t; this.spill.visible = this.rift.visible; this.halo.rotation.z = reduced ? 0 : Math.sin(t * 0.7) * 0.12; }
  local(point: THREE.Vector3) { return this.root.worldToLocal(point.clone()); }
  dispose() { this.root.removeFromParent(); this.owned.forEach(item => item.dispose()); }
}
