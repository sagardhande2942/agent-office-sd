import { spawn } from 'node:child_process';
import { execFileSync } from 'node:child_process';
import type { BossCheck } from '../../shared/boss-mode/types.js';
export const gitHead=(dir:string)=>execFileSync('git',['rev-parse','HEAD'],{cwd:dir,encoding:'utf8',timeout:20000}).trim();
export function redact(log:string) {return log.replace(/(?:Bearer\s+)[\w.\-]+/gi,'Bearer [redacted]').replace(/((?:TOKEN|SECRET|PASSWORD|API_KEY)\s*[=:]\s*)[^\s]+/gi,'$1[redacted]').slice(-12000);}
export async function verifyChecks(dir:string,commands:string[],signal:AbortSignal,changed:(check:BossCheck)=>void,env?:Record<string,string>):Promise<void> {
  if(!commands.length)throw Error('Configure independent verification commands before implementation');
  const commit=gitHead(dir);
  for(const command of commands){
    if(signal.aborted)throw Error('Verification interrupted; work preserved');
    const check:BossCheck={command,commit,startedAt:Date.now(),log:''};changed(check);
    const exitCode=await new Promise<number>((resolve,reject)=>{
      const child=spawn('bash',['-lc',command],{cwd:dir,env:env?{...process.env,...env}:process.env,stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
      let escalation:NodeJS.Timeout|undefined;
      const kill=(signal:NodeJS.Signals)=>{try{if(process.platform!=='win32'&&child.pid)process.kill(-child.pid,signal);else child.kill(signal);}catch{}};
      const stop=()=>{kill('SIGTERM');escalation??=setTimeout(()=>kill('SIGKILL'),1000);};
      const timer=setTimeout(stop,15*60000);signal.addEventListener('abort',stop,{once:true});
      const append=(data:Buffer)=>{check.log=redact(check.log+data.toString());};child.stdout.on('data',append);child.stderr.on('data',append);
      child.on('error',error=>{clearTimeout(timer);clearTimeout(escalation);signal.removeEventListener('abort',stop);reject(error);});
      child.on('close',code=>{clearTimeout(timer);clearTimeout(escalation);signal.removeEventListener('abort',stop);resolve(code??-1);});
    });
    check.exitCode=exitCode;check.finishedAt=Date.now();changed(check);
    if(exitCode!==0)throw Error('Independent check failed: '+command);
    if(gitHead(dir)!==commit||execFileSync('git',['status','--porcelain'],{cwd:dir,encoding:'utf8'}).trim())throw Error('Verification changed the checkout; commit and rerun checks');
  }
}
