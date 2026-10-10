import { createTeam } from './runtime.js';
import path from 'node:path';
import type { Ctx } from '../office/context.js';
import type { Floor } from '../floor.js';
import type { TeamAction, TeamState } from '../../shared/master-workers.js';
import { TeamCoordinator } from './coordinator.js';
import { TeamPresets } from './storage.js';
const stores=new WeakMap<Ctx, Map<string, TeamCoordinator>>();
const presetStores=new WeakMap<Ctx, TeamPresets>();
export function teamPresets(ctx:Ctx) {
  let p=presetStores.get(ctx); if(!p) { p=new TeamPresets(path.join(ctx.cfg.dataDir,'master-workers-presets.json')); presetStores.set(ctx,p); } return p;
}
function broadcast(ctx:Ctx,floor:Floor,state:TeamState) { for(const c of ctx.clients.values()) if(c.peer.floor===floor.id) ctx.sendTo(c,{t:'master-workers',state}); }
export function broadcastTeams(ctx:Ctx) {
  for(const [id,s] of stores.get(ctx)??[]) { const f=ctx.floors.get(id); if(f) broadcast(ctx,f,s.state()); }
  for(const floor of ctx.remoteFloors.values()) {
    floor.masterWorkers.presets(teamPresets(ctx).state());
    ctx.toFloor(floor,{t:'master-workers',state:floor.masterWorkers.state()});
  }
}
export function team(ctx:Ctx,floor:Floor): TeamCoordinator {
  let all=stores.get(ctx); if(!all) stores.set(ctx,all=new Map());
  let s=all.get(floor.id); if(s) return s;
  s=createTeam(floor,teamPresets(ctx),()=>{ const run=all!.get(floor.id); if(run) broadcast(ctx,floor,run.state()); });
  all.set(floor.id,s); return s;
}
export function startTeamClock(ctx:Ctx) {
  const timer=setInterval(()=>{
    for(const f of ctx.remoteFloors.values()) f.masterWorkers.capacity(ctx.machine.room(), f.workers.list().length, ctx.ledger.hiringPaused);
    for(const f of ctx.floors.values()) {
      const s=team(ctx,f); void s.tick().catch(()=>{});
    }
  },2000);timer.unref();return()=>clearInterval(timer);
}
export async function teamAction(ctx:Ctx,floor:Floor,id:string,body:TeamAction) { return team(ctx,floor).action(id,body); }
