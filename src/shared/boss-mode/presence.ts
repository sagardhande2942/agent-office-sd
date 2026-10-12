import type { BossPoint, BossPresence } from './types.js';
export const bossDistance = (a: BossPoint,b: BossPoint) => Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
export function bossPosition(p: BossPresence, now: number): { at: BossPoint; walking: boolean; face: number } {
  let left=Math.max(0,now-p.startedAt)/1000*p.speed;
  for(let i=1;i<p.path.length;i++) {
    const a=p.path[i-1],b=p.path[i],length=bossDistance(a,b);
    if(left<length){const k=length?left/length:1;return {at:[a[0]+(b[0]-a[0])*k,a[1]+(b[1]-a[1])*k,a[2]+(b[2]-a[2])*k],walking:true,face:Math.atan2(b[0]-a[0],b[2]-a[2])};}
    left-=length;
  }
  return {at:p.path.at(-1)??[0,0,0],walking:false,face:p.face};
}
