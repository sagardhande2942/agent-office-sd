import { readFileSync } from 'node:fs';
import type { ClientMsg, FloorView } from '../../shared/protocol.js';
export function teamCommand(line:string,send:(msg:ClientMsg)=>void,open:()=>void):boolean {
  const [cmd,...rest]=line.split(/\s+/),arg=rest.join(' ');
  if(cmd==='teams'){open();return true;}
  if(cmd==='team-start'||cmd==='team-preset') {
    if(!arg)throw Error(`Usage: ${cmd} <JSON-file>`);
    const value=JSON.parse(readFileSync(arg,'utf8'));
    send(cmd==='team-start'?{t:'master-workers.start',request:value}:{t:'master-workers.preset',preset:value});return true;
  }
  if(cmd==='team-preset-delete'){if(!arg)throw Error('Provide preset ID');send({t:'master-workers.preset',remove:arg});return true;}
  const actions={'team-pause':'pause','team-resume':'resume','team-stop':'stop'} as const;
  if(cmd in actions){send({t:'master-workers.control',action:actions[cmd as keyof typeof actions]});return true;}
  return false;
}
export function teamLines(view?:FloorView):string[] {
  const s=view?.masterWorkers,r=s?.current;
  return [
    'MASTER / WORKERS',s?.error??'',
    ...(r?[`${r.phase}: ${r.brief}`,`Master: ${r.masterId??'not started'} (${r.master.provider}/${r.master.model})`,r.error??'',r.plan??'Planning...',...r.tasks.flatMap(t=>[`${t.id}: ${t.status} — ${t.title}`,t.reason??'',...t.attempts.map(a=>`${a.choice.provider}/${a.choice.model}: ${a.status} (${a.workerId}) ${a.summary??''}`),t.evidence??'']),r.pr??'']:['No activity yet.']),
    'PRESETS',...(s?.presets.map(p=>`${p.id}: ${p.name} (${p.maxWorkers} workers)`)??[]),
    'teams | team-start <JSON-file> | team-pause | team-resume | team-stop',
    'team-preset <JSON-file> | team-preset-delete <ID> | attach <worker>',
  ];
}
