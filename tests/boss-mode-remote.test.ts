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

test('unknown and disconnected host capabilities produce connecting state, not an upgrade error',async()=>{
  let supported:boolean|undefined,reachable=false,calls=0;
  const boss=new RemoteBoss(async()=>{calls++;return bossInitial();},()=>supported,()=>reachable);
  assert.equal(boss.state().connection,'connecting');
  await assert.rejects(boss.control({action:'on'}),/Connecting to floor host/);
  reachable=true;await assert.rejects(boss.control({action:'on'}),/Connecting to floor host/);
  supported=true;assert.equal(boss.state().connection,'connecting','wait for initial Boss snapshot');
  boss.receive({...bossInitial(),enabled:true,config:{...bossInitial().config,mission:'Add a car'}});
  assert.equal(boss.state().connection,'ready');
  reachable=false;boss.reset();assert.equal(boss.state().connection,'connecting');
  assert.equal(boss.state().config.mission,'Add a car');
  supported=false;await assert.rejects(boss.control({action:'on'}),/Connecting to floor host/);
  reachable=true;await assert.rejects(boss.control({action:'on'}),/Update the floor host/);
  assert.equal(boss.state().connection,'unsupported');assert.equal(calls,0);
});

test('hosts without the coordination contract reject activation but retain stop controls',async()=>{
 const calls:string[]=[];
 const boss=new RemoteBoss(async(type)=>{calls.push(type);return bossInitial();},()=>true,()=>true,()=>false);
 await assert.rejects(boss.control({action:'on'}),/Update the floor host.*compact team tools/);
 assert.equal(calls.length,0);await boss.control({action:'stop-now'});assert.deepEqual(calls,['boss.control']);
});
