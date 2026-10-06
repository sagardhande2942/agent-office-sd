import test from 'node:test';
import assert from 'node:assert/strict';
import { analytics, dispatchTargets, eligible, findMostIdleWorker, MAX_PROMPT, planDispatch } from '../src/client/features/boss/logic.js';
import { floorReport, reportLink } from '../src/client/features/boss/report.js';
import { validBossGuard, validBossPrompt, type BossGuard } from '../src/shared/boss.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
import { WorkerManager } from '../src/server/workers.js';
import { workerHandlers } from '../src/server/ws/handlers/workers.js';

const worker = (id: string, extra: Partial<WorkerInfo> = {}): WorkerInfo => ({ id, kind: 'agent', deskId: 'desk-1', name: id, color: '#123456', status: 'idle', acked: false, createdAt: 1, createdBy: 'QA', cols:80, rows:24, viewers:[], viewerIds:[], ...extra });
const guard: BossGuard = { floor: 'f1', createdAt: 1, status: 'idle' };

test('boss dispatch excludes shells, helpers, meetings, boards, approvals and unavailable sessions', () => {
  const bad = [worker('shell',{kind:'shell'}),worker('helper',{helper:{hostId:'host',hostName:'Host'}}),worker('meeting',{meeting:'m'}),worker('board',{deskId:'station-issues'}),worker('lost',{lost:{branch:'here'}}),...(['needs_input','offline','exited','starting'] as const).map(status=>worker(status,{status}))];
  for (const w of bad) assert.equal(eligible(w), false, w.id);
  const plan=planDispatch('f1','Check tests',[...bad,worker('ready'),worker('busy',{status:'working'})],false)!;
  assert.deepEqual(plan.targets.map(w=>w.id),['ready','busy']);
  assert.equal(findMostIdleWorker(bad),undefined);
});

test('auto-assign prefers idle then completed agents, never busy agents', () => {
  const old=worker('old',{createdAt:2}),newer=worker('new',{createdAt:3});
  assert.equal(findMostIdleWorker([newer,worker('done',{status:'done',createdAt:0}),old])?.id,'old');
  assert.equal(findMostIdleWorker([worker('working',{status:'working'}),worker('done',{status:'done'})])?.id,'done');
  assert.equal(findMostIdleWorker([worker('working',{status:'working'})]),undefined);
});

test('review snapshots are floor-bound, revalidate sessions, and never add newly hired workers', () => {
  const w=worker('a');const plan=planDispatch('f1','hello',[w],false)!;
  w.status='needs_input';assert.equal(plan.targets[0].status,'idle');
  assert.deepEqual(dispatchTargets(plan,'f1',new Map([['a',w],['b',worker('b')]])),[]);
  assert.deepEqual(dispatchTargets(plan,'f2',new Map([['a',worker('a')]])),[]);
  assert.deepEqual(dispatchTargets(plan,'f1',new Map([['a',worker('a',{createdAt:99})]])),[]);
  assert.deepEqual(dispatchTargets(plan,'f1',new Map([['a',worker('a')],['b',worker('b')]])).map(w=>w.id),['a']);
  assert.deepEqual(dispatchTargets(plan,'f1',new Map()),[]);
});

test('bounded prompts reject terminal control bytes and excessive recipient counts', () => {
  for(const text of ['', 'x'.repeat(MAX_PROMPT+1),'test\x1b[201~\ryes']) { assert.equal(validBossPrompt(text),false); assert.equal(planDispatch('f1',text,[worker('a')],false),undefined); }
  assert.equal(validBossPrompt('Line one\nLine two\tindented'),true);
  assert.equal(planDispatch(null,'hi',[worker('a')],false),undefined);
  assert.equal(planDispatch('f1','hi',Array.from({length:51},(_,i)=>worker(String(i))),false),undefined);
});

test('report output treats worker text as text and rejects unsafe PR links', () => {
  const report=floorReport('<img src=x onerror=alert(1)>',[worker('evil',{name:'evil | <script>x</script>\nrow',prompt:'PRIVATE FULL PROMPT',activity:'[click](javascript:alert(1))',pr:{number:1,url:'javascript:alert(1)'}})],new Date(0));
  assert.ok(!report.includes('<script>')&&!report.includes('<img')&&!report.includes('PRIVATE FULL PROMPT'));
  assert.ok(report.includes('&lt;script&gt;'));assert.ok(report.includes('\\|'));
  for (const url of ['javascript:alert(1)','data:text/html,evil','file:///tmp/secret','https://user:password@host/a','not a URL']) assert.equal(reportLink(url),undefined);
  assert.equal(reportLink('https://github.com/org/repo/pull/1'),'https://github.com/org/repo/pull/1');
  assert.ok(!reportLink('https://example.com/a(b)')!.includes('('));
});

test('guard validation rejects malformed guards and changes at the server', () => {
  for (const g of [undefined,null,false,{}, {...guard,createdAt:NaN},{...guard,createdAt:2},{...guard,status:'working'}]) assert.equal(validBossGuard(worker('a'),g),false);
  assert.equal(validBossGuard(worker('a'),guard),true);
  assert.equal(validBossGuard(worker('a',{kind:'shell'}),guard),false);
});

test('session boundary prevents guarded writes to changed workers and suppresses delayed Enter at an approval', async () => {
  const writes:string[]=[];const w={info:worker('a'),pty:{write:(s:string)=>writes.push(s)}};
  const manager={workers:new Map([['a',w]]),tasks:{notePrompt:()=>{}},emitUpdate:()=>{}} as unknown as WorkerManager;
  assert.ok(WorkerManager.prototype.prompt.call(manager,'a','hi','QA',{...guard,status:'working'}));assert.deepEqual(writes,[]);
  assert.ok(WorkerManager.prototype.prompt.call(manager,'a','\x1b[201~','QA',guard));assert.deepEqual(writes,[]);
  assert.equal(WorkerManager.prototype.prompt.call(manager,'a','hi','QA',guard),undefined);assert.equal(writes.length,1);
  w.info.status='needs_input';await new Promise(r=>setTimeout(r,160));assert.equal(writes.length,1);
});

test('WebSocket boundary rejects a guarded cross-floor prompt and forwards valid guard metadata', async () => {
  const sent:unknown[][]=[];const warnings:string[]=[];const floor={id:'f1',workers:{get:()=>worker('a'),prompt:(...a:unknown[])=>{sent.push(a);}}};
  let here='f2';const ctx={actionWorkerFloor:()=>floor,floorOf:()=>({id:here}),warn:(_c:unknown,s?:string)=>{if(s)warnings.push(s);}};
  const c={peer:{name:'QA'}};const msg={t:'worker.prompt' as const,workerId:'a',prompt:'hi',guard};
  await workerHandlers['worker.prompt'](ctx as never,c as never,msg);assert.equal(sent.length,0);assert.equal(warnings.length,1);
  here='f1';await workerHandlers['worker.prompt'](ctx as never,c as never,msg);assert.equal(sent.length,1);assert.deepEqual(sent[0][3],guard);
});

test('analytics counts actual statuses and never labels sleeping workers idle', () => {
  assert.deepEqual(analytics([worker('a',{status:'working'}),worker('b',{status:'offline'}),worker('c',{status:'needs_input'})]),{total:3,working:1,needs:1,done:0,tokens:0,cost:0});
});
