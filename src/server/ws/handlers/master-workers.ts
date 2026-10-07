import type { MasterWorkersClientMsg } from '../../../shared/protocol.js';
import type { HandlerMap, ViewPieces } from './types.js';
import { here } from './common.js';
import { team, teamPresets, broadcastTeams } from '../../master-workers/service.js';
import { request } from '../../master-workers/storage.js';
export const masterWorkersView:ViewPieces['masterWorkers']=(ctx,floor)=>{const f=ctx.asLocal(floor);return f?team(ctx,f).state():{current:null,past:[],presets:teamPresets(ctx).state()};};
export const masterWorkersHandlers={
  'master-workers.start'(ctx,c,msg) {
    const f=ctx.asLocal(here(ctx,c));if(!f){ctx.warn(c,'Master / Workers requires a local Git floor');return;}
    try {
      const r=request(msg.request);
      if(!f.project.branch) throw Error('Master / Workers requires a Git project');
      if([r.master,...r.models].some(a=>!f.project.agentProviders.includes(a.provider))) throw Error('Select installed providers');
      ctx.withSignIn(c,ctx.claudeFor([r.master,...r.models].some(a=>a.provider==='claude')?'claude':undefined),()=>ctx.withFreshBase(c,f,()=>{try{team(ctx,f).start(r,c.accountId);}catch(e){ctx.warn(c,(e as Error).message);}}));
    }catch(e){ctx.warn(c,(e as Error).message);}
  },
  'master-workers.control'(ctx,c,msg){const f=ctx.asLocal(here(ctx,c));if(f)try{if(!['pause','resume','stop'].includes(msg.action))throw Error('Unknown control');team(ctx,f).control(msg.action,c.accountId);}catch(e){ctx.warn(c,(e as Error).message);}},
  'master-workers.preset'(ctx,c,msg){try{teamPresets(ctx).edit(msg.preset,msg.remove);broadcastTeams(ctx);}catch(e){ctx.warn(c,(e as Error).message);}},
} satisfies HandlerMap<MasterWorkersClientMsg>;
