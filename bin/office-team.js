#!/usr/bin/env node
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { TEAM_TOOLS, callTeam } from './office-team-tools.js';
export async function main(argv,io={}) {
  const out=io.out??console.log,err=io.err??console.error;
  try {
    if(argv.length===1&&argv[0]==='--help'){out(JSON.stringify(TEAM_TOOLS,null,2));return 0;}
    if(argv.length!==1||!['state','action'].includes(argv[0]))throw Error('Use state, action (JSON stdin), or --help');
    let args={};
    if(argv[0]==='action') {
      const read=io.read??(async()=>{let body='';for await(const chunk of process.stdin){body+=chunk;if(body.length>200000)throw Error('Input exceeds 200,000 characters');}return body;});
      const body=await read();if(body.length>200000)throw Error('Input exceeds 200,000 characters');args=JSON.parse(body);
    }
    out((await callTeam(argv[0]==='state'?'team_state':'team_action',args,io)).text);return 0;
  }catch(e){err(e.message);return 1;}
}
if(process.argv[1]&&realpathSync(process.argv[1])===fileURLToPath(import.meta.url))process.exitCode=await main(process.argv.slice(2));
