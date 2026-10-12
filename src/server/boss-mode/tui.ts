import { readFileSync } from 'node:fs';
import type { ClientMsg,FloorView } from '../../shared/protocol.js';
export function bossCommand(line:string,send:(msg:ClientMsg)=>void,open:()=>void):boolean {
  const [cmd,...args]=line.split(/\s+/),text=args.join(' ');
  if(cmd==='boss'){send({t:'boss.get'});open();return true;}
  if(['boss-on','boss-off','boss-stop'].includes(cmd)){send({t:'boss.control',control:{action:cmd==='boss-on'?'on':cmd==='boss-off'?'off':'stop-now'}});return true;}
  if(cmd==='boss-steer'){send({t:'boss.control',control:{action:'steer',text}});return true;}
  if(cmd==='boss-config'){send({t:'boss.control',control:{action:'configure',config:JSON.parse(readFileSync(text,'utf8'))}});return true;}
  return false;
}
export function bossLines(view?:FloorView):string[]{
  const state=view?.bossMode;if(!state)return ['Boss mode unavailable on this floor.'];
  return ['BOSS OFFICE',state.phase+' · '+(state.enabled?'ON':'OFF'),state.message,'Mission: '+state.config.mission,'Maximum workers: '+state.config.maxWorkers,
    ...state.backlog.map(i=>i.status+': '+i.title+(i.pr?' '+i.pr:'')),...state.steering.slice(-5).map(s=>s.status+': '+s.text),
    'boss | boss-on | boss-off | boss-stop | boss-steer <instruction> | boss-config <JSON-file>'];
}
