import { LOFT, STAIRS } from '../../shared/layout.js';
import { NavGrid } from '../../shared/nav.js';
import type { BossPoint } from '../../shared/boss-mode/types.js';
const centerX=(LOFT.minX+LOFT.maxX)/2,centerZ=(LOFT.minZ+LOFT.maxZ)/2;
const loftNav=new NavGrid(LOFT,{rects:[[centerX-0.8,centerX+1.8,centerZ-0.9,centerZ+0.3],[LOFT.maxX-1.15,LOFT.maxX,centerZ-1.2,centerZ+1.2]],circles:[]});
export function loftPath(a:BossPoint,b:BossPoint):BossPoint[]{
  return loftNav.route([a[0],a[2]],[b[0],b[2]]).slice(1).map(([x,z])=>[x,LOFT.y,z]);
}
export function stairPoints():BossPoint[]{
  const z=(STAIRS.minZ+STAIRS.maxZ)/2;
  return Array.from({length:STAIRS.steps+1},(_,i)=>[STAIRS.fromX+(STAIRS.toX-STAIRS.fromX)*i/STAIRS.steps,LOFT.y*i/STAIRS.steps,z]);
}
