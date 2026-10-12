import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,rmSync,mkdirSync,copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { commandLine,readTuiJson,unknownCommand } from '../src/server/tui/commands.js';
import { connectionFailure,signInFailure } from '../src/server/tui/connection.js';
import { teamCommand } from '../src/server/master-workers/tui.js';

test('quoted JSON paths dispatch unchanged values; file errors never dispatch a team',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'office-tui-files-')),file=path.join(dir,'a plan.json'),messages:unknown[]=[];
  try{
    const request={brief:'Implement a reliable CLI',master:{provider:'codex'},models:[{provider:'opencode',model:'opencode/exo-free'}],maxWorkers:1};
    writeFileSync(file,JSON.stringify(request));
    teamCommand(commandLine(`:team-start "${file}"`),msg=>messages.push(msg),()=>{});
    assert.deepEqual(messages,[{t:'master-workers.start',request}]);
    assert.deepEqual(readTuiJson(`'${file}'`,'plan-start'),request);
    writeFileSync(file,'{broken');
    assert.throws(()=>teamCommand(`team-start ${file}`,msg=>messages.push(msg),()=>{}),/Invalid JSON.*retry team-start/);
    assert.throws(()=>readTuiJson(path.join(dir,'missing.json'),'plan-start'),/Cannot read JSON.*TUI machine/);
    assert.throws(()=>readTuiJson('','plan-start'),/Usage: plan-start/);
    assert.throws(()=>readTuiJson('"unclosed','plan-start'),/Close the quote/);
    assert.equal(messages.length,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('connection and command errors tell users how to recover without exposing a password',()=>{
  assert.match(connectionFailure(new Error('fetch failed',{cause:{code:'ECONNREFUSED'}}),'http://localhost:4600'),/Start agent-office.*another terminal/);
  assert.match(connectionFailure({cause:{code:'ENOTFOUND'}},'https://office.example.test'),/Check the --office/);
  assert.match(signInFailure(401),/account.*password/);
  assert.match(signInFailure(429),/Wait/);
  assert.match(unknownCommand('npx'),/another terminal/);
  assert.match(unknownCommand('boss-on'),/unavailable in this build/);
  assert.match(unknownCommand('workres'),/workres.*help/);
});
test('an unbuilt source checkout gives a build instruction instead of a module stack trace',()=>{
  const dir=mkdtempSync(path.join(os.tmpdir(),'office-unbuilt-'));mkdirSync(path.join(dir,'bin'));
  try{
    writeFileSync(path.join(dir,'package.json'),'{"type":"module"}');copyFileSync('bin/agent-office.js',path.join(dir,'bin/agent-office.js'));
    const result=spawnSync(process.execPath,[path.join(dir,'bin/agent-office.js'),'tui'],{encoding:'utf8'});
    assert.equal(result.status,1);assert.match(result.stderr,/npm ci && npm run build/);assert.doesNotMatch(result.stderr,/at ModuleLoader/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
