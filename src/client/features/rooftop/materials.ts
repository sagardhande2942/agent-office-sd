import * as THREE from 'three';
import { AXE_LANE } from '../../../shared/bargames';
import { DANCE_FLOOR, DJ_BOOTH, ELEVATOR, ELEVATOR_FRONT, FIRE_PIT, FLOOR, ROOF_BAR, ROOF_TABLES, SEATING_BY_ID, STAGE, WALL_HEIGHT, WALL_T } from '../../../shared/layout';
import type { DjFrame } from '../../dnb';
import { buildBarGames, type BarGamesView } from '../bargames/world';
import { Worker } from '../../world/character';
import { buildCity, type City } from '../../world/city';
import { buildElevator, type Elevator } from '../../world/elevator';
import type { Collider, Interactable } from '../../world/types';
import { bulb, type NightParts } from '../../world/outside';
import { canvasTexture } from '../../world/texture';
import { mergeByMaterial, mesh, roundedBox, toon, toonUnique } from '../../world/toon';
import { B } from './world';


/** Teak decking, the boards running east–west. */
export function deckTexture(): THREE.CanvasTexture {
  const w = B.maxX - B.minX;
  const d = B.maxZ - B.minZ;
  const px = 24;
  return canvasTexture(Math.round(w * px), Math.round(d * px), (g) => {
    g.fillStyle = '#b98457';
    g.fillRect(0, 0, w * px, d * px);
    const board = 0.14 * px;
    for (let y = 0, row = 0; y < d * px; y += board, row++) {
      // Each row of boards a slightly different tone, with joints staggered along it.
      const tone = 0.9 + ((row * 37) % 11) / 55;
      g.fillStyle = `rgb(${Math.round(185 * tone)}, ${Math.round(132 * tone)}, ${Math.round(87 * tone)})`;
      g.fillRect(0, y, w * px, board - 1.5);
      g.fillStyle = 'rgba(70, 40, 20, 0.35)';
      for (let x = ((row * 53) % 7) * px * 0.4; x < w * px; x += 2.4 * px) g.fillRect(x, y, 1.5, board);
    }
  });
}


/** A beam of light: a cone that fades along its length and toward its edges, added onto what's behind. */
export function beamMaterial(): THREE.ShaderMaterial {
  const m = new THREE.ShaderMaterial({
    uniforms: { color: { value: new THREE.Color() }, opacity: { value: 0 } },
    vertexShader: `
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        vAlong = uv.y;
        vec4 mv = modelViewMatrix * vec4( position, 1.0 );
        vN = normalize( normalMatrix * normal );
        vView = normalize( -mv.xyz );
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: `
      uniform vec3 color;
      uniform float opacity;
      varying float vAlong;
      varying vec3 vN;
      varying vec3 vView;
      void main() {
        float edge = pow( abs( dot( normalize( vN ), normalize( vView ) ) ), 1.6 );
        float a = opacity * vAlong * vAlong * edge;
        gl_FragColor = vec4( color * a, a );
      }`,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  m.userData.outlineParameters = { visible: false };
  return m;
}
