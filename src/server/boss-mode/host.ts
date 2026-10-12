import type { MapState } from '../../shared/protocol.js';
import type { Floor } from '../floor.js';
import type { BossControl } from '../../shared/boss-mode/types.js';
import { floorBoss } from './service.js';
export const bossHostSnapshot=(floor:Floor)=>({t:'boss.state' as const,floor:floor.id,state:floorBoss(floor).state()});
export const bossHostCalls:Record<string,(floor:Floor,msg:Record<string,unknown>)=>unknown>={
  'boss.get':floor=>floorBoss(floor).state(),
  'boss.control':async(floor,msg)=>{await floorBoss(floor).control(msg.control as BossControl,msg.owner as string|undefined);return floorBoss(floor).state();},
  'boss.capacity':(floor,msg)=>{if(typeof msg.room!=='number'||!Number.isFinite(msg.room)||msg.room<0||typeof msg.allowed!=='boolean')throw Error('Invalid Boss capacity grant');floorBoss(floor).capacity(msg.room,msg.owner as string|undefined,msg.allowed,msg.map as MapState|undefined);},
};
