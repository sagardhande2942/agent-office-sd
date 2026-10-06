import { deskPoint } from '../../../shared/nav';
import * as THREE from 'three';
import { PLAN_REVIEW_TABLE, PLAN_REVIEW_SEATS, MEETING_TABLE, MEETING_LAPTOP, deskSeat, type DeskDef } from '../../../shared/layout';
import { mesh, roundedBox, textPlane, toon } from '../../world/toon';
import type { DeskView, Interactable } from '../../world/types';
import type { Fixture } from '../../world/office/fixture';
import { PALETTE, box } from '../../world/office/materials';
import { chair } from '../../world/office/seats';
function buildMeetingSeat(def: DeskDef, index: number): DeskView {
  const group = new THREE.Group();
  group.position.set(def.x, 0, def.z);
  group.rotation.y = def.rotY;
  const laptopAnchor = new THREE.Object3D();
  laptopAnchor.position.set(0, MEETING_TABLE.height, MEETING_LAPTOP.z);
  laptopAnchor.scale.setScalar(MEETING_LAPTOP.scale);
  group.add(laptopAnchor);
  const seatAnchor = new THREE.Object3D();
  seatAnchor.position.set(0, 0.4, 0.85);
  seatAnchor.rotation.y = Math.PI;
  seatAnchor.scale.setScalar(0.82);
  group.add(seatAnchor);
  const ch = chair(['#2b2d42', '#ef476f', '#118ab2', '#06d6a0', '#ffd166'][index % 5]);
  ch.position.set(0, 0, 0.85);
  group.add(ch);
  // A merge's dance party: up on its chair rather than the table, where the laptops are close together.
  const stage = new THREE.Object3D();
  stage.position.set(0, 0.48, 0.85);
  group.add(stage);
  // Nobody is hired here from the floor, so there's no '+' over a free chair: a meeting fills them.
  const vacancy = new THREE.Group();
  group.add(vacancy);
  return { def, group, laptopAnchor, seatAnchor, stage, chair: ch, vacancy, vacancyY: 0 };
}
export const planReviewTable: Fixture<never> = site => {
  const pt=PLAN_REVIEW_TABLE;
  const planTable=mesh(roundedBox(pt.width,0.12,pt.depth,0.08),toon('#93b6ac'),pt.x,pt.height-0.06,pt.z);
  site.group.add(planTable);
  for (const x of [-pt.width/2+0.3,pt.width/2-0.3]) site.group.add(mesh(box(0.12,pt.height,0.12),toon('#2b2d42'),pt.x+x,pt.height/2,pt.z));
  const planInteraction:Interactable={kind:'plan-review',x:pt.x,z:pt.z,radius:2.8};
  planTable.userData.interact=planInteraction;site.interactables.push(planInteraction);
  site.colliders.push({minX:pt.x-pt.width/2,maxX:pt.x+pt.width/2,minZ:pt.z-pt.depth/2,maxZ:pt.z+pt.depth/2,top:pt.height});
  for(const [i,def] of PLAN_REVIEW_SEATS.entries()) {const seat=buildMeetingSeat(def,i);site.group.add(seat.group);site.desks.set(def.id,seat);const it:Interactable={kind:'plan-review-seat',deskId:def.id,x:def.x,z:def.z,radius:1};seat.group.userData.interact=it;site.interactables.push(it);const [x,z]=deskPoint(def,0,0.85);site.colliders.push({minX:x-0.3,maxX:x+0.3,minZ:z-0.3,maxZ:z+0.3,top:0.5});}
  const planSign=textPlane('PLAN COMPARISON',{size:26});planSign.position.set(pt.x,1.5,pt.z);planSign.userData.interact=planInteraction;site.group.add(planSign);

  return { handle: {} };
};
