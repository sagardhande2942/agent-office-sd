import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteBoss } from '../src/server/boss-mode/surface.js';
import { bossInitial } from '../src/shared/boss-mode/config.js';

test('remote boss mirrors host state and forwards ownership and capacity leases',async()=>{
  const calls:{type:string;body:Record<string,unknown>}[]=[];
  const state={...bossInitial(),enabled:true,owner:'admin',phase:'discovering' as const};
  const boss=new RemoteBoss(async(type,body)=>{calls.push({type,body});return state;},()=>true);
  await boss.control({action:'on'},'admin');
  assert.equal(boss.state().enabled,true);
  assert.deepEqual(calls[0],{type:'boss.control',body:{control:{action:'on'},owner:'admin'}});
  await boss.capacity(4,'admin',false);
  assert.deepEqual(calls[1],{type:'boss.capacity',body:{room:4,owner:'admin',allowed:false,map:undefined}});
  boss.receive({...state,enabled:false});assert.equal(boss.state().enabled,false);
  boss.receive({version:0,enabled:true});assert.equal(boss.state().enabled,false);
});
test('remote boss surfaces unsupported hosts and host rejection without changing cached state',async()=>{
  const old=new RemoteBoss(async()=>{throw Error('Must not call an old host');},()=>false);
  await assert.rejects(old.control({action:'on'}),/Update the floor host/);
  const denied=new RemoteBoss(async()=> 'Admin permission required',()=>true);
  await assert.rejects(denied.control({action:'on'}),/Admin permission/);
  assert.equal(denied.state().enabled,false);
});
