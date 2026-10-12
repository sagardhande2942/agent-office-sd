import { loftPath, stairPoints } from './loft-path.js';
import { LOFT, STAIRS, SEATING, DESK_BY_ID, seatPlace } from '../../shared/layout.js';
import { bossPosition, bossDistance } from '../../shared/boss-mode/presence.js';
import type { BossPoint, BossPresence, BossState } from '../../shared/boss-mode/types.js';
import { officeNav, nearestWalkable, NavGrid } from '../../shared/nav.js';
import { helperSpot } from '../../shared/helper.js';
import type { Floor, FloorContext } from '../floor.js';
const z=(STAIRS.minZ+STAIRS.maxZ)/2;
const foot:BossPoint=[STAIRS.fromX-0.6,0,z], top:BossPoint=[LOFT.minX+0.6,LOFT.y,z];
function across(a:BossPoint,b:BossPoint,wing:number):BossPoint[] {
  return officeNav(wing).route([a[0],a[2]],[b[0],b[2]]).slice(1).map(([x,z])=>[x,0,z]);
}
function officePath(a:BossPoint,b:BossPoint,wing:number):BossPoint[] {
  const upper=a[1]>1,wantsUpper=b[1]>1;
  if(upper&&wantsUpper)return [a,...loftPath(a,b),b];
  const stairs=stairPoints();
  if(a[1]>0&&a[0]>=STAIRS.fromX&&a[0]<=STAIRS.toX&&Math.abs(a[2]-z)<0.8)return wantsUpper?[a,...stairs.filter(p=>p[0]>a[0]),top,...loftPath(top,b),b]:[a,...stairs.reverse().filter(p=>p[0]<a[0]),foot,...across(foot,b,wing)];
  if(upper)return [a,...loftPath(a,top),top,...stairs.reverse(),foot,...across(foot,b,wing)];
  if(wantsUpper)return [a,...across(a,foot,wing),...stairs,top,...loftPath(top,b),b];
  return [a,...across(a,b,wing)];
}
export function presenceFor(state:BossState,floor:Floor,ctx:FloorContext):BossPresence {
  const now=Date.now(),plan=ctx.navigation?.(),isOffice=!plan||plan.style==='office';
  const nav=isOffice?officeNav(floor.plan.wing):new NavGrid(plan!.bounds,plan!.obstacles??{rects:[],circles:[]});
  const roster=floor.workers.list(),run=state.team?.current;
  const focus=[...state.events].reverse().find(e=>e.kind==='focus'&&roster.some(w=>w.id===e.initiative&&run?.workers.some(p=>p.workerId===w.id)));
  const review=run?.tasks.find(t=>t.status==='review'||t.attempts.at(-1)?.notice==='needs_input');
  const target=state.active?(focus?.initiative??review?.attempts.at(-1)?.workerId):undefined;
  const worker=roster.find(w=>w.id===target),desk=worker&&(plan?.byId.get(worker.deskId)??DESK_BY_ID.get(worker.deskId));
  const idle=!state.active&&state.phase!=='discovering';
  let at:BossPoint,face=0,seat:string|undefined;
  const activity=desk?'Checking '+worker!.name:idle?'Idle · monitoring the floor':'Planning and coordinating';
  if(desk) {const spot=helperSpot(desk),p=isOffice?nearestWalkable(spot.at,floor.plan.wing):nav.nearestWalkable(spot.at);at=[p[0],0,p[1]];face=spot.face;}
  else if(idle) {
    const seats=isOffice?SEATING:plan!.seating;
    const sofa=seats.find(s=>s.id==='loft-couch')??seats.find(s=>!s.roof&&!s.bar&&!s.tv);
    const taken=new Set(ctx.peers(floor).map(p=>p.seat));
    const index=sofa?.places.findIndex((_,i)=>!taken.has(sofa.id+':'+i))??-1;
    if(sofa&&index>=0){const place=seatPlace(sofa,index);at=[place.x,place.y,place.z];face=place.rotY;seat=place.key;}
    else at=isOffice?[LOFT.minX+1,LOFT.y,z]:[plan!.door.x,0,plan!.door.z];
  } else {
    const waypoints=isOffice?[[1,0,7],[4,0,-7],[0,0,0]] as BossPoint[]:[[plan!.door.x,0,plan!.door.z]] as BossPoint[];
    // Hold each inspection stop long enough to read; state changes do not jitter the destination.
    at=waypoints[Math.floor(now/20000)%waypoints.length];
  }
  const map=plan?.id??'office';
  const old=state.presence?.map===map?state.presence:undefined;
  if(old&&bossDistance(old.path.at(-1)!,at)<0.1&&old.seat===seat&&old.target===target)return {...old,activity};
  const from=old?bossPosition(old,now).at:at;
  const path=isOffice?officePath(from,at,floor.plan.wing):[from,...nav.route([from[0],from[2]],[at[0],at[2]]).slice(1).map(([x,z])=>[x,0,z] as BossPoint)];
  return {path,startedAt:now,speed:1.8,face,activity,target,seat,map};
}
