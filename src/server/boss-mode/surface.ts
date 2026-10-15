import type { MapState } from '../../shared/protocol.js';
import type { BossControl, BossState } from '../../shared/boss-mode/types.js';
import { bossInitial } from '../../shared/boss-mode/config.js';
export interface BossSurface {
  state():BossState;
  control(control:BossControl,owner?:string):Promise<unknown>;
  capacity?(room:number,owner:string|undefined,allowed:boolean,map?:MapState):Promise<unknown>;
}
export class RemoteBoss implements BossSurface {
  private current=bossInitial();
  private received=false;
  constructor(private call:(t:string,body:Record<string,unknown>)=>Promise<unknown>,readonly supported:()=>boolean|undefined,private reachable:()=>boolean=()=>true,private contractSupported:()=>boolean=()=>true){}
  state():BossState{return {...this.current,connection:!this.reachable()||this.supported()===undefined?'connecting':this.supported()===false?'unsupported':this.received?'ready':'connecting'};}
  reset(){this.received=false;}
  receive(raw:unknown){const state=raw as BossState;if(state?.version===1){this.current=state;this.received=true;}}
  async control(control:BossControl,owner?:string){if(control.action==='on'&&!this.contractSupported())throw Error('Update the floor host for task specifications and compact team tools');const value=await this.command('boss.control',{control,owner});this.receive(value as BossState);}
  capacity(room:number,owner:string|undefined,allowed:boolean,map?:MapState){return this.command('boss.capacity',{room,owner,allowed,map});}
  private async command(t:string,body:Record<string,unknown>){if(!this.reachable()||this.supported()===undefined)throw Error('Connecting to floor host; try again when Boss mode is ready');if(!this.supported())throw Error('Update the floor host to support Boss mode');const result=await this.call(t,body);if(typeof result==='string')throw Error(result);return result;}
}
