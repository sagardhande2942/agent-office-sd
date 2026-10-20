// Real Python bridge + real Office meeting/memory engines; scripted agents, no paid model calls.
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { ResearchBridge } from '../src/server/research-routing/bridge.ts';
import { TeamRouter } from '../src/server/research-routing/router.ts';
import { findRoutedMeeting } from '../src/server/research-routing/results.ts';
import { MeetingSpaces } from '../src/server/meeting-spaces/service.ts';
import { Worktrees } from '../src/server/worktrees.ts';
import { researchPattern } from '../src/shared/research-patterns.ts';
import { recordMeetingReview } from '../src/server/knowledge/meetings.ts';
const middleware = process.env.RESEARCH_OFFICE_TEST_ROOT;
if (!middleware) throw Error('Set RESEARCH_OFFICE_TEST_ROOT to the middleware checkout under test');
const root = mkdtempSync(path.join(tmpdir(), 'research-route-e2e-'));
const project = path.join(root, 'project'); mkdirSync(project);
const git = (...args) => execFileSync('git', args, { cwd: project, stdio: 'ignore' });
git('init', '-q', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test');
writeFileSync(path.join(project, 'README.md'), '# Research fixture\n'); git('add', '.'); git('commit', '-qm', 'initial');
const token = 'fixture-' + 'x'.repeat(40);
const python = spawn(process.env.PYTHON ?? 'python3', ['-u', '-c', `
import sys
from research_office.config import Config
from research_office.store import Store
from research_office.pipeline import TeamQueue
from research_office.pipeline.server import bridge_server
c=Config(state_dir=sys.argv[1],artifact_dir=sys.argv[2])
s=Store(c.state_dir,c.artifact_dir);q=TeamQueue(s);q.configure('local','Find a falsifiable hypothesis',max_candidates=1,max_active=1,continuous=True);q.control('running');s.db.close()
server=bridge_server(c,0);print(server.server_port,flush=True);server.serve_forever()
`, path.join(root, 'state'), path.join(root, 'artifacts')], { cwd: middleware, env: { ...process.env, AGENT_OFFICE_RESEARCH_BRIDGE_TOKEN: token }, stdio: ['ignore','pipe','pipe'] });
let stderr = ''; python.stderr.on('data', d => stderr += d.toString());
const lines = createInterface({ input: python.stdout });
let rooms;
try {
  const [line] = await Promise.race([once(lines, 'line'), once(python, 'exit').then(() => { throw Error(stderr || 'Bridge exited'); }), new Promise((_,reject) => setTimeout(() => reject(Error('Bridge startup timeout')),10000).unref())]);
  const bridge = new ResearchBridge(`http://127.0.0.1:${Number(line)}/research/v1/`, 'local', token);
  const workers = []; let count = 0;
  const manager = { defaultProvider: 'claude', list: () => workers,
    seat(deskId, _by, prompt, provider, model, effort, meeting) { const w = { id: 'w'+(++count), kind: 'agent', name: 'Fixture '+count, deskId, prompt, provider, model, effort, status: 'done', meeting: meeting.id, worktree: meeting.worktree }; workers.push(w); return w; },
    prompt(id, prompt) { workers.find(w => w.id === id).prompt = prompt; }, write() {},
    async kill(id) { const i=workers.findIndex(w => w.id===id); if(i>=0)workers.splice(i,1); return {}; } };
  rooms = new MeetingSpaces(project, path.join(project,'.agent-office'), manager, new Worktrees(project), { update() {}, toast() {}, hiringPaused() {}, postReview: async () => '' });
  const floor = { id: 'local', def: { dir: project }, meetings: rooms };
  const router = new TeamRouter(path.join(root,'router.json'), bridge, {
    allowed() {}, available() { return !rooms.state().spaces.some(s=>s.current?.status==='running'); },
    find: key=>findRoutedMeeting(floor,key),
    async retire(id,key) { const space=rooms.state().spaces.find(s=>s.current?.id===id&&s.current.routingKey===key); if(space)rooms.clear('Fixture router',space.id); },
    async start(task,key,id) {
      const name=task.department; if(!rooms.state().spaces.some(s=>s.name===name))assert.equal(rooms.create(name),undefined);
      const space=rooms.state().spaces.find(s=>s.name===name); const p=researchPattern(task.pattern);
      assert.equal(rooms.start({spaceId:space.id,pattern:task.pattern,prompt:JSON.stringify(task.input),roles:p.roles.slice(0,p.seats.default)},'Fixture',undefined,{key,id}),undefined);
      return findRoutedMeeting(floor,key);
    }
  },'local');
  const finish = outcome => {
    const space=rooms.state().spaces.find(s=>s.current?.status==='running'); const m=space.current;
    const cwd=m.worktree?path.resolve(project,m.worktree.path):project;
    const take=(seat,text)=>{ const turn=rooms.state().spaces.find(s=>s.id===space.id).current.turns.find(t=>t.seat===seat); const w=workers.find(w=>w.id===m.seats[seat].workerId); w.status='working';rooms.onWorker(w);const file=path.join(cwd,turn.file);mkdirSync(path.dirname(file),{recursive:true});writeFileSync(file,text);w.status='done';rooms.onWorker(w); };
    for(let round=0;round<2;round++) for(const turn of [...rooms.state().spaces.find(s=>s.id===space.id).current.turns])take(turn.seat,'Fixture independent assessment');
    const p=researchPattern(m.pattern);
    const output=JSON.stringify({schema_version:1,pattern_version:1,meeting_id:m.id,pattern:m.pattern,outcome,summary:'Fixture: insufficient market evidence',evidence_run_ids:[],findings:[],dissent:[],next_action:'Archive scoped finding',details:Object.fromEntries(p.required.map(k=>[k,'Fixture missing input']))});
    mkdirSync(path.dirname(path.join(cwd,m.output)),{recursive:true});writeFileSync(path.join(cwd,m.output),output);writeFileSync(path.join(cwd,m.output+'.md'),'# Fixture finding\nNo market evidence.');
    recordMeetingReview(project,m,workers.find(w=>w.id===m.seats[0].workerId),[],'No supported durable market lesson in fixture');
    take(0,output); assert.equal(rooms.state().spaces.find(s=>s.id===space.id).current.status,'done');
  };
  await router.poll(); finish('inconclusive'); await router.poll(); finish('no_durable_lesson'); await router.poll();
  const status = await bridge.call('status');
  assert.equal(status.activity.admissions,1); assert.equal(status.candidates[0].state,'review_complete');
  assert.equal(status.tasks.length,2); assert.ok(status.tasks.every(t=>t.state==='done'));
  assert.equal(workers.length,0);
  console.log(JSON.stringify({passed:true, tasks:status.tasks.map(t=>t.department), candidate_state:status.candidates[0].state, paid_calls:0}));
} finally {
  rooms?.shutdown(); lines.close(); python.kill('SIGTERM'); await once(python,'exit').catch(()=>{}); rmSync(root,{recursive:true,force:true});
}
