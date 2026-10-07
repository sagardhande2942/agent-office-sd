import type { TeamState } from '../../../shared/master-workers';
import type { Slice } from '../store';
declare module '../store' { interface Store { masterWorkers: TeamState; } interface Topics { masterWorkers: true; } }
export const masterWorkers:Slice={
  init(s){s.masterWorkers={current:null,past:[],presets:[]};},
  on:{'master-workers'(s,m){s.masterWorkers=m.state;return ['masterWorkers'];}},
  enter(s,v){s.masterWorkers=v.masterWorkers??{current:null,past:[],presets:[]};return ['masterWorkers'];},
};
