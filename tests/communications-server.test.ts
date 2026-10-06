import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConfig } from '../src/server/config.js';
import { startServer } from '../src/server/server.js';
import { WebSocket } from 'ws';

test('authenticated workers coordinate without prompting and observers receive persistent receipts', { timeout: 30_000 }, async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'office-message-server-'));
  const cfg = loadConfig([dir, '--password', 'test-inbox', '--no-open', '--agent', process.execPath]);
  cfg.port = 0; cfg.agentArgs = ['-e', 'setInterval(() => {}, 1000)'];
  const office = await startServer(cfg);
  let ws: WebSocket | undefined;
  try {
    const floor = office.floors()[0]; await floor.ready;
    const ada = await floor.workers.spawn('desk-1', 'tester', undefined, false, 'agent', 'custom');
    const grace = await floor.workers.spawn('desk-2', 'tester', undefined, false, 'agent', 'custom');
    assert.ok(typeof ada !== 'string' && typeof grace !== 'string');
    const token = (id: string) => JSON.parse(readFileSync(path.join(dir, '.agent-office/workers.json'), 'utf8')).find((w: { id: string }) => w.id === id).hookToken;
    const port = (office.server.address() as { port: number }).port;
    const origin = `http://localhost:${port}`;
    const login = await fetch(origin + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'test-inbox' }) });
    const cookie = login.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    const observed: any[] = [];
    ws = new WebSocket(origin.replace('http:', 'ws:') + '/ws?lite=1', { headers: { Origin: origin, Cookie: cookie } });
    ws.on('message', (raw) => observed.push(JSON.parse(String(raw))));
    const waitFor = async (predicate: () => boolean) => {
      const deadline = Date.now() + 5000;
      while (!predicate() && Date.now() < deadline) await new Promise((resolve) => setTimeout(resolve, 20));
      assert.ok(predicate());
    };
    await waitFor(() => observed.some((m) => m.t === 'welcome'));
    const call = async (id: string, action: string, body?: object, suppliedToken = token(id)) => {
      const res = await fetch(`http://127.0.0.1:${office.hookPort}/office/workers/${action}?worker=${id}`, {
        method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${suppliedToken}`, 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, body: await res.json() as any };
    };
    assert.equal((await call(ada.id, 'inbox', undefined, 'bad')).status, 401);
    // Any attempt to interrupt a terminal fails the test, including wake-up through resume.
    floor.workers.prompt = async () => { throw new Error('Tracked messages must never prompt workers'); };
    floor.workers.resume = () => { throw new Error('Tracked messages must never wake workers'); };
    const request = await call(grace.id, 'request', { worker: ada.id, prompt: 'What fields will /users return?', key: 'users' });
    assert.equal(request.status, 200); assert.equal(request.body.message.status, 'pending');
    const id = request.body.message.id;
    const retry = await call(grace.id, 'request', { worker: ada.id, prompt: 'What fields will /users return?', key: 'users' });
    assert.equal(retry.body.message.id, id);
    assert.equal((await call(grace.id, 'ack', { id })).status, 400, 'sender cannot claim recipient read it');
    assert.equal((await call(ada.id, 'inbox')).body.messages[0].status, 'delivered');
    const reply = await call(ada.id, 'reply', { id, prompt: '{ id, name }', context: { branch: 'api/users', commit: 'abcdef1', files: ['users.ts'] }, key: 'reply' });
    assert.equal(reply.status, 200);
    assert.equal((await call(grace.id, 'ack', { id: reply.body.message.id })).status, 200);
    await waitFor(() => observed.some((m) => m.t === 'communications' && m.state.messages.some((r: any) => r.id === id && r.status === 'completed')));
    const inbox = await call(grace.id, 'inbox');
    assert.equal(inbox.body.messages.find((m: any) => m.id === id).status, 'completed');
    const shell = await floor.workers.spawn('desk-3', 'tester', undefined, false, 'shell'); assert.ok(typeof shell !== 'string');
    assert.equal((await call(grace.id, 'request', { worker: shell.id, prompt: 'Never execute this' })).status, 400);
    assert.equal((await call(grace.id, 'request', { worker: 'another-floor-worker', prompt: 'Wrong floor' })).status, 400);
    // The office derives meeting membership and round, never trusting supplied links.
    const spoof = await call(grace.id, 'request', { worker: ada.id, prompt: 'Not a meeting', meeting: { id: 'forged', round: 9 } });
    assert.equal(spoof.body.message.meeting, undefined);
    assert.equal(await floor.meetings.start({ pattern: 'debate', prompt: 'Agree API contract', roles: [], rounds: 2, provider: 'custom' }, 'tester'), undefined);
    const meeting = floor.meetings.state().current!;
    const [seatA, seatB] = meeting.seats.map((s) => s.workerId!);
    const linked = await call(seatA, 'request', { worker: seatB, prompt: 'Fields?', key: 'meeting-contract', meeting: { id: 'forged', round: 99 } });
    assert.equal(linked.status, 200);
    assert.deepEqual(linked.body.message.meeting, { id: meeting.id, round: 1 });
    const incoming = await call(ada.id, 'request', { worker: seatA, prompt: 'External dependency' });
    assert.deepEqual(incoming.body.message.meeting, { id: meeting.id, round: 1 });
    const answer = await call(seatB, 'reply', { id: linked.body.message.id, prompt: 'id, name' });
    assert.deepEqual(answer.body.message.meeting, linked.body.message.meeting);
    const files = path.join(dir, '.agent-office/communications', Buffer.from(floor.id).toString('hex'), 'communications.json');
    const stored = JSON.parse(readFileSync(files, 'utf8'));
    assert.deepEqual(stored.find((m: any) => m.id === answer.body.message.id).meeting, linked.body.message.meeting);
    assert.ok(floor.meetings.finishAnyway('forged', 'tester'));
    const hook = async (id: string, event: string, payload: object = {}, suppliedToken = token(id)) => {
      const res = await fetch(`http://127.0.0.1:${office.hookPort}/hooks/claude?worker=${id}&event=${event}`, { method:'POST', headers:{authorization:`Bearer ${suppliedToken}`, 'content-type':'application/json'}, body:JSON.stringify(payload) });
      return { status:res.status, body:await res.json() as any };
    };
    await hook(ada.id,'SessionStart',{session_id:'ada-root'});
    await hook(ada.id,'UserPromptSubmit',{session_id:'ada-root',prompt:'Build API'});
    await call(grace.id, 'request', { worker: ada.id, prompt: 'New dependency during work' });
    const duringTask = await hook(ada.id,'PostToolUse',{session_id:'ada-root',tool_name:'Bash'});
    assert.equal(duringTask.status,200);
    assert.match(duringTask.body.hookSpecificOutput.additionalContext,/CURRENT task/);
    assert.equal(floor.workers.get(ada.id)!.status,'working');
    assert.equal((await hook(ada.id,'PostToolUse',{session_id:'ada-root'},'bad')).status,401);
    const stop = await hook(ada.id,'Stop',{session_id:'ada-root'});
    assert.equal(stop.body.decision,'block');
    assert.equal(floor.workers.get(ada.id)!.status,'working','continuation must not mark task done');
    // A helper report uses both channels; reading alone leaves the manual card, ack removes it.
    floor.workers.finding = () => 'Found the API contract mismatch in users.ts';
    const helper = floor.workers.sendHelper(ada.id,'tester','custom'); assert.ok(typeof helper !== 'string');
    (floor as any).onHelperUpdate({...helper,status:'done'});
    const reportId = floor.workers.get(ada.id)!.helperReport!.messageId!;
    assert.ok(reportId);
    await floor.workers.kill(helper.id);
    await call(ada.id,'inbox');
    assert.equal(floor.workers.get(ada.id)!.helperReport!.messageId,reportId);
    assert.equal((await call(ada.id,'ack',{id:reportId})).status,200);
    assert.equal(floor.workers.get(ada.id)!.helperReport,undefined);
    assert.ok(await floor.workers.deliverHelperReport(ada.id,'tester'),'the other path no longer exists');
    const helper2 = floor.workers.sendHelper(ada.id,'tester','custom'); assert.ok(typeof helper2 !== 'string');
    (floor as any).onHelperUpdate({...helper2,status:'done'});
    const manualId = floor.workers.get(ada.id)!.helperReport!.messageId!;
    floor.workers.get(ada.id)!.status='done';
    let submissions=0;floor.workers.prompt=()=>{submissions++;return undefined;};
    assert.equal(await floor.workers.deliverHelperReport(ada.id,'tester'),undefined);
    assert.equal(submissions,1);assert.equal(floor.workers.get(ada.id)!.helperReport,undefined);
    const manual=(await call(ada.id,'inbox')).body.messages.find((m:any)=>m.id===manualId);
    assert.equal(manual.status,'completed');assert.equal(manual.helperReport.handledVia,'terminal');
    assert.ok(await floor.workers.deliverHelperReport(ada.id,'tester'));assert.equal(submissions,1);
    await floor.workers.kill(helper2.id);
    const helper3 = floor.workers.sendHelper(ada.id,'tester','custom'); assert.ok(typeof helper3 !== 'string');
    (floor as any).onHelperUpdate({...helper3,status:'done'});
    const recoveredId = floor.workers.get(ada.id)!.helperReport!.messageId!;
    floor.workers.get(ada.id)!.helperReport!.state='submitted';
    const recovered = (await call(ada.id,'inbox')).body.messages.find((m:any)=>m.id===recoveredId);
    assert.equal(recovered.status,'completed'); assert.equal(recovered.helperReport.handledVia,'terminal');
    assert.equal(floor.workers.get(ada.id)!.helperReport,undefined); assert.equal(submissions,1,'reconciliation must never submit again');



  } finally {
    ws?.terminate(); office.shutdown();
    await new Promise((resolve) => setTimeout(resolve, 300));
    rmSync(dir, { recursive: true, force: true });
  }
});
