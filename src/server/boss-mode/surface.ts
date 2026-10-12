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
  constructor(private call:(t:string,body:Record<string,unknown>)=>Promise<unknown>,readonly supported:()=>boolean){}
  state(){return this.current;}
  receive(raw:unknown){const state=raw as BossState;if(state?.version===1)this.current=state;}
  async control(control:BossControl,owner?:string){const value=await this.command('boss.control',{control,owner});this.receive(value as BossState);}
  capacity(room:number,owner:string|undefined,allowed:boolean,map?:MapState){return this.command('boss.capacity',{room,owner,allowed,map});}
  private async command(t:string,body:Record<string,unknown>){if(!this.supported())throw Error('Update the floor host to support Boss mode');const result=await this.call(t,body);if(typeof result==='string')throw Error(result);return result;}
}
