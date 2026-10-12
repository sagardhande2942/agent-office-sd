import type { BossState } from '../../../shared/boss-mode/types';
import { bossInitial } from '../../../shared/boss-mode/config';
import type { Slice } from '../store';
declare module '../store' { interface Store { bossMode:BossState; } interface Topics { bossMode:true; } }
export const bossMode:Slice={
  init(s){s.bossMode=bossInitial();},
  on:{'boss.state'(s,m){if(m.floor!==s.floor)return [];s.bossMode=m.state;return ['bossMode'];}},
  enter(s,v){s.bossMode=v.bossMode??bossInitial();return ['bossMode'];},
};
