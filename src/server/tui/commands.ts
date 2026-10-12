import { readFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Examples often include the dashboard's colon; accept pasting it too. */
export const commandLine = (line:string) => line.trim().replace(/^:\s*/, '');
export function readTuiJson(raw:string,command:string):unknown {
  let file=raw.trim();
  if(!file)throw Error(`Usage: ${command} <JSON-file>`);
  if(file.startsWith('"')||file.startsWith("'")){
    if(file.at(-1)!==file[0])throw Error('Close the quote around the JSON file path');
    file=file.slice(1,-1);
  }
  if(file==='~')file=os.homedir();else if(file.startsWith('~/'))file=path.join(os.homedir(),file.slice(2));
  file=path.resolve(file);
  let contents:string;
  try{contents=readFileSync(file,'utf8');}catch{throw Error(`Cannot read JSON file: ${file}. Paths refer to the TUI machine.`);}
  try{return JSON.parse(contents);}catch{throw Error(`Invalid JSON in ${file}. Fix the file, then retry ${command}.`);}
}
export function unknownCommand(cmd:string):string {
  if(['node','npm','npx','agent-office','cd','git'].includes(cmd))return 'Run shell commands in another terminal. Here use help, workers, or hire codex <task>.';
  if(cmd==='boss'||cmd.startsWith('boss-'))return 'Boss commands are unavailable in this build. Use a build containing Boss mode for both server and TUI.';
  return `Unknown command: ${cmd}. Press ? for help or type help.`;
}
