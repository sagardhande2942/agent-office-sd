import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { LoreCurator } from '../src/server/lore-curator/service.js';
import { CuratorMemory } from '../src/server/lore-curator/memory.js';
import { nextCuratorRun } from '../src/server/lore-curator/schedule.js';
import { repositoryEvidence } from '../src/server/lore-curator/evidence.js';
import { createCuratorAgent, curatorSchema } from '../src/server/lore-curator/agent.js';
import { applyActions, parseActions } from '../src/server/lore-curator/actions.js';
import { DEFAULT_CURATOR_SETTINGS, validateCuratorSettings } from '../src/shared/lore-curator.js';
import { selectWorkerLore } from '../src/shared/worker-lore.js';
import { RemoteCurator } from '../src/server/lore-curator/surface.js';
import type { CuratorAgent } from '../src/server/lore-curator/agent.js';
import type { ServerMsg, WorkerInfo } from '../src/shared/protocol.js';
const evidence = { commit: 'fixture-commit', files: [{ path: 'src/database.ts', excerpt: 'pool.max = 20' }] };
function fixture(agent: CuratorAgent = async () => ({ summary: 'Reviewed', actions: [] })) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'curator-test-')), memory = new CuratorMemory(dir), messages: ServerMsg[] = [];
  let at = Date.parse('2026-10-11T00:00:00Z');
  const make = () => new LoreCurator('floor-1', dir, memory, 'unused', m => messages.push(m), { timer: false, now: () => at, providers: ['claude', 'codex'], agent, evidence: async () => evidence });
  const service = make();
  return { dir, memory, service, messages, make, advance(ms: number) { at += ms; }, close() { service.shutdown(); rmSync(dir, { recursive: true, force: true }); } };
}
const save = (m: CuratorMemory, id: string, content: string, title = 'Database pool') => m.save({ id, title, content, author: 'Worker', tags: ['database'] });
test('schedule settings validate model/provider, bounds, timezone and DST once-per-date', () => {
  const daily = { ...DEFAULT_CURATOR_SETTINGS, schedule: 'daily' as const, dailyTime: '02:00', timezone: 'Asia/Kolkata' };
  assert.equal(new Date(nextCuratorRun(daily, Date.parse('2026-10-11T00:00:00Z'))).toISOString(), '2026-10-11T20:30:00.000Z');
  const fall = { ...daily, dailyTime: '01:30', timezone: 'America/New_York' };
  assert.equal(new Date(nextCuratorRun(fall, Date.parse('2026-11-01T05:45:00Z'))).toISOString(), '2026-11-02T06:30:00.000Z');
  const spring = { ...daily, dailyTime: '02:30', timezone: 'America/New_York' };
  assert.equal(new Date(nextCuratorRun(spring, Date.parse('2026-03-08T05:00:00Z'))).toISOString(), '2026-03-09T06:30:00.000Z');
  for (const patch of [{ intervalMinutes: 0 }, { timezone: 'wrong/time' }, { provider: 'custom' }, { model: '--bad' }, { maxNotes: 51 }, { dailyTime: '25:00' }, { enabled: 1 }]) assert.throws(() => validateCuratorSettings({ ...DEFAULT_CURATOR_SETTINGS, ...patch }));
});
test('exact duplicates consolidate without model calls, archive reversibly and persist across restart', async () => {
  let calls = 0; const f = fixture(async () => { calls++; throw Error('Must not call a model for identical content'); });
  try {
    save(f.memory, 'one', 'Pool maximum is 20'); save(f.memory, 'two', ' Pool maximum is 20 ', 'Connection pool limit');
    await f.service.run(); assert.equal(calls, 0); assert.equal(f.service.state().runs[0].status, 'completed');
    const superseded = f.memory.list().find(n => n.curation?.status === 'superseded')!;
    assert.ok(f.service.state().runs[0].decisions?.some(d => d.id === superseded.id && d.before === 'active' && d.after === 'superseded'));
    assert.equal(f.memory.raw().length, 2); assert.equal(selectWorkerLore(f.memory.list(), 'database pool').length, 1);
    const reloaded = new CuratorMemory(f.dir); assert.equal(reloaded.get(superseded.id)?.curation?.status, 'superseded');
    f.service.restore(superseded.id); assert.equal(f.memory.get(superseded.id)?.curation?.status, 'active');
  } finally { f.close(); }
});
test('semantic merges preserve both observations and original authors; conflicting corrections keep revision history', async () => {
  const f = fixture(async () => ({ summary: 'Consolidated pool setup', actions: [{ action: 'merge', id: 'two', target: 'one', reason: 'Compatible pool setup facts', evidence: ['src/database.ts'] }] }));
  try {
    save(f.memory, 'one', 'Pool maximum is 20'); save(f.memory, 'two', 'Reset the pool after each test');
    await f.service.run(); const merged = f.memory.get('one')!;
    assert.match(merged.content, /maximum is 20/); assert.match(merged.content, /Reset the pool/); assert.deepEqual(merged.curation?.sources.sort(), ['one', 'two']);
    save(f.memory, 'one', 'Correction: maximum is 40');
    assert.equal(f.memory.get('one')?.curation?.status, 'needs-verification');
    assert.equal(selectWorkerLore(f.memory.list(), 'pool').length, 0);
    assert.equal(f.service.history('one').length, 2); f.service.restore('one', 0);
    assert.equal(f.memory.get('one')?.content, 'Pool maximum is 20');
  } finally { f.close(); }
});
test('invalid actions are rejected as a batch; verification requires supplied evidence and handovers stay separate', () => {
  const f = fixture();
  try {
    const one = save(f.memory, 'one', 'Observed pool');
    const action = { action: 'verify', id: 'one', target: '', reason: 'Checked', evidence: [] };
    assert.throws(() => parseActions({ summary: 'ok', actions: [action] }, [one], evidence), /requires/);
    assert.throws(() => parseActions({ summary: 'ok', actions: [{ ...action, evidence: ['secret.env'] }] }, [one], evidence), /unsupported/i);
    assert.throws(() => parseActions({ summary: 'ok', actions: [{ ...action, id: '../other-floor' }] }, [one], evidence));
    const handover = f.memory.save({ id: 'handover', title: 'Handover', content: 'Reported pool test', author: 'Other worker', tags: ['handover'] });
    const result = applyActions(f.memory, [one, handover], [{ action: 'merge', id: handover.id, target: one.id, reason: 'same', evidence: [] }], evidence, Date.now());
    assert.equal(result.skipped, 1); assert.equal(f.memory.get(handover.id)?.curation?.status, 'active');
  } finally { f.close(); }
});
test('run schemas constrain note IDs, merge targets and exact evidence paths', async () => {
  const schema = curatorSchema(['one', 'two'], ['src/database.ts']);
  const properties = schema.properties.actions.items.properties;
  assert.deepEqual((properties.id as any).enum, ['one', 'two']);
  assert.deepEqual((properties.target as any).enum, ['', 'one', 'two']);
  assert.deepEqual((properties.evidence.items as any).enum, ['src/database.ts']);
  assert.equal((properties.evidence as any).maxItems, 1);
  assert.equal((curatorSchema(['one'], []).properties.actions.items.properties.evidence as any).maxItems, 0);
  const f = fixture(async (_settings, prompt, _signal, suppliedSchema) => {
    const notes = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)).notes;
    assert.deepEqual(suppliedSchema, curatorSchema(notes.map((n: any) => n.id), ['src/database.ts']));
    return { summary: 'Verified', actions: [{ action: 'verify', id: 'one', target: '', reason: 'Pool limit matches excerpt', evidence: ['src/database.ts'] }] };
  });
  try {
    const one = save(f.memory, 'one', 'Pool maximum is 20');
    await f.service.run(); assert.equal(f.service.state().runs[0].status, 'completed');
    assert.throws(() => parseActions({ summary: 'Wrong citation', actions: [{ action: 'verify', id: 'one', target: '', reason: 'Checked', evidence: ['src/database.ts:1'] }] }, [one], evidence), /Unsupported evidence.*exact supplied/);
    assert.throws(() => parseActions({ summary: 'Wrong note', actions: [{ action: 'archive', id: 'unknown', target: '', reason: 'Old', evidence: [] }] }, [one], evidence), /note ID.*supplied batch/);
  } finally { f.close(); }
});
test('only relevant active knowledge is injected; unrelated notes cannot fill remaining slots', () => {
  const f = fixture();
  try {
    save(f.memory, 'pool', 'Maximum is 20'); f.memory.save({ id: 'unrelated', title: 'Theme colors', content: 'The CSS color is green', author: 'Worker', tags: ['theme'] });
    assert.deepEqual(selectWorkerLore(f.memory.list(), 'database pool').map(n => n.id), ['pool']);
    assert.deepEqual(selectWorkerLore(f.memory.list(), 'telescope orbit'), []);
  } finally { f.close(); }
});
test('persistent schedule catches up once after restart, respects pause and forwards chosen model and batch', async () => {
  let calls = 0, picked: unknown; const f = fixture(async (settings, prompt) => { calls++; picked = settings; const notes = JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)).notes; assert.equal(notes.length, 2); return { summary: 'Checked batch', actions: [] }; });
  let resumed: LoreCurator | undefined;
  try {
    for (let i = 0; i < 4; i++) save(f.memory, `note-${i}`, `Pool fact ${i}`);
    f.service.configure({ ...DEFAULT_CURATOR_SETTINGS, enabled: true, intervalMinutes: 5, provider: 'codex', model: 'gpt-5.5', maxNotes: 2 });
    f.advance(20 * 60000); f.service.shutdown(); resumed = f.make(); await resumed.tick(); await resumed.tick();
    assert.equal(calls, 1); assert.equal((picked as any).model, 'gpt-5.5'); assert.equal(resumed.state().pending, 2);
    assert.equal(resumed.state().nextRunAt, Date.parse('2026-10-11T00:25:00Z'));
    resumed.pause(true); f.advance(10 * 60000); await resumed.tick(); assert.equal(calls, 1);
    assert.equal(new CuratorMemory(f.dir).journal.data.settings.paused, true);
    resumed.pause(false); await resumed.tick(); assert.equal(calls, 2);
  } finally { resumed?.shutdown(); f.close(); }
});
test('failed runs retain pending work, retry with backoff, and disallow concurrent runs', async () => {
  let calls = 0; const f = fixture(async () => { calls++; throw Error('Agent is offline'); });
  try {
    save(f.memory, 'one', 'Pool maximum is 20'); f.service.configure({ ...DEFAULT_CURATOR_SETTINGS, enabled: true, intervalMinutes: 5 });
    f.advance(5 * 60000); await f.service.tick(); assert.equal(f.service.state().runs[0].status, 'failed'); assert.equal(f.service.state().pending, 1);
    await f.service.tick(); assert.equal(calls, 1); f.advance(5 * 60000); await f.service.tick(); assert.equal(calls, 2);
    assert.equal(f.service.state().retryAt, Date.parse('2026-10-11T00:20:00Z'));
  } finally { f.close(); }
});
test('pause cancels in-flight recommendations and concurrent edits cannot be archived', async () => {
  let finish!: (value: unknown) => void;
  const f = fixture(() => new Promise(resolve => { finish = resolve; }));
  try {
    save(f.memory, 'one', 'Pool maximum is 20');
    const running = f.service.run(); await new Promise(r => setImmediate(r));
    await assert.rejects(f.service.run(), /already/);
    save(f.memory, 'one', 'Pool maximum is now 30');
    finish({ summary: 'Archive', actions: [{ action: 'archive', id: 'one', target: '', reason: 'Outdated pool fact', evidence: [] }] });
    await running; assert.equal(f.service.state().runs[0].skipped, 1); assert.equal(f.memory.get('one')?.content, 'Pool maximum is now 30');
    const second = f.service.run(); await new Promise(r => setImmediate(r)); f.service.pause(true);
    finish({ summary: 'Archive', actions: [{ action: 'archive', id: 'one', target: '', reason: 'Old', evidence: [] }] });
    await second; assert.equal(f.service.state().runs[0].status, 'cancelled'); assert.notEqual(f.memory.get('one')?.curation?.status, 'archived');
  } finally { f.close(); }
});
test('worker completion queues one debounced run and event trigger can be disabled', async () => {
  let calls = 0; const f = fixture(async () => { calls++; return { summary: 'Reviewed', actions: [] }; });
  try {
    save(f.memory, 'one', 'Pool maximum is 20'); f.service.configure({ ...DEFAULT_CURATOR_SETTINGS, enabled: true });
    const feature = f.service.feature(); const worker = { id: 'worker', kind: 'agent', deskId: 'desk-1', completionRevision: 1, completion: { revision: 1, summary: 'done' } } as WorkerInfo;
    feature.update?.(worker); feature.update?.(worker); f.advance(30000); await f.service.tick(); assert.equal(calls, 1);
    feature.update?.(worker); f.advance(30000); await f.service.tick(); assert.equal(calls, 1);
    f.service.configure({ ...DEFAULT_CURATOR_SETTINGS, enabled: true, afterCompletion: false });
    save(f.memory, 'two', 'Reset pool'); feature.update?.({ ...worker, completion: { ...worker.completion!, summary: 'corrected' } });
    f.advance(30000); await f.service.tick(); assert.equal(calls, 1);
  } finally { f.close(); }
});
test('committed evidence is bounded and excludes credentials and uncommitted changes', async () => {
  const f = fixture();
  try {
    execFileSync('git', ['init'], { cwd: f.dir, stdio: 'ignore' }); mkdirSync(path.join(f.dir, 'src'));
    writeFileSync(path.join(f.dir, 'src/database.ts'), 'pool.max = 20'); writeFileSync(path.join(f.dir, 'secrets.json'), '{"token":"private-secret"}');
    execFileSync('git', ['add', 'src/database.ts', 'secrets.json'], { cwd: f.dir });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'fixture'], { cwd: f.dir, stdio: 'ignore' });
    writeFileSync(path.join(f.dir, 'src/database.ts'), 'pool.max = 40');
    const e = await repositoryEvidence(f.dir, [save(f.memory, 'one', 'database secrets')]);
    assert.deepEqual(e.files.map(x => x.path), ['src/database.ts']); assert.equal(e.files[0].excerpt, 'pool.max = 20'); assert.ok(e.commit);
  } finally { f.close(); }
});
test('background CLI adapters forward models over stdin, disable tools/hooks, and keep cwd outside the repo', async () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'curator-agent-test-'));
  try {
    const command = path.join(dir, 'fake-agent'), log = path.join(dir, 'log.json');
    writeFileSync(command, `#!${process.execPath}\nconst fs=require('fs');let prompt='';process.stdin.on('data',c=>prompt+=c);process.stdin.on('end',()=>{fs.writeFileSync(${JSON.stringify(log)},JSON.stringify({args:process.argv.slice(2),cwd:process.cwd(),prompt,schema:JSON.parse(process.argv.includes('--json-schema')?process.argv[process.argv.indexOf('--json-schema')+1]:fs.readFileSync(process.argv[process.argv.indexOf('--output-schema')+1],'utf8')),token:process.env.AGENT_OFFICE_HOOK_TOKEN}));const body={summary:'Fixture',actions:[]};const i=process.argv.indexOf('--output-last-message');if(i>=0)fs.writeFileSync(process.argv[i+1],JSON.stringify(body));else console.log(JSON.stringify({structured_output:body}));});`, { mode: 0o755 });
    const agent = createCuratorAgent({ claude: command, codex: command });
    for (const provider of ['claude', 'codex'] as const) {
      await agent({ ...DEFAULT_CURATOR_SETTINGS, provider, model: provider === 'claude' ? 'sonnet' : 'gpt-5.5' }, 'Untrusted note data', new AbortController().signal, curatorSchema(['one'], ['src/database.ts']));
      const launch = JSON.parse(readFileSync(log, 'utf8')); assert.deepEqual(launch.schema, curatorSchema(['one'], ['src/database.ts'])); assert.equal(launch.prompt, 'Untrusted note data'); assert.notEqual(launch.cwd, dir); assert.equal(launch.token, undefined);
      assert.ok(launch.args.includes('--model')); assert.ok(launch.args.includes(provider === 'claude' ? '--strict-mcp-config' : '--ignore-user-config'));
    }
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
test('remote curator uses host RPCs and rejects an older host instead of managing office-local disk', async () => {
  const calls: unknown[] = [];
  const remote = new RemoteCurator(async (t, body) => { calls.push({ t, body }); return t === 'curator.get' ? { settings: DEFAULT_CURATOR_SETTINGS } : undefined; }, () => true);
  await remote.configure({ ...DEFAULT_CURATOR_SETTINGS, provider: 'codex', model: 'gpt-5.5' }); await remote.pause(true); await remote.start(); await remote.restore('one', 0);
  assert.deepEqual(calls.map((x: any) => x.t), ['curator.configure', 'curator.pause', 'curator.run', 'curator.restore']);
  assert.equal((await remote.state()).settings.provider, 'claude');
  await assert.rejects(new RemoteCurator(async () => undefined, () => false).start(), /Update the floor host/);
});

test('completion-triggered pending work survives a restart and disabled agent choices remain saved', async () => {
  let calls = 0; const f = fixture(async () => { calls++; return { summary: 'Restart review', actions: [] }; });
  let resumed: LoreCurator | undefined;
  try {
    save(f.memory, 'one', 'Pool maximum is 20');
    f.service.configure({ ...DEFAULT_CURATOR_SETTINGS, provider: 'codex', model: 'gpt-5.5' });
    f.service.shutdown(); resumed = f.make(); assert.equal(resumed.state().settings.provider, 'codex');
    resumed.configure({ ...DEFAULT_CURATOR_SETTINGS, enabled: true, intervalMinutes: 60 });
    resumed.feature().update?.({ id: 'worker', kind: 'agent', deskId: 'desk-1', completionRevision: 1, completion: { revision: 1 } } as WorkerInfo);
    resumed.shutdown(); f.advance(60000);
    const loaded = new CuratorMemory(f.dir);
    resumed = new LoreCurator('floor-1', f.dir, loaded, 'unused', () => {}, { timer: false, now: () => Date.parse('2026-10-11T00:01:00Z'), providers: ['claude'], agent: async () => { calls++; return { summary: 'Recovered', actions: [] }; }, evidence: async () => evidence });
    await resumed.tick(); assert.equal(calls, 1); assert.equal(resumed.state().runs[0].trigger, 'worker completion');
  } finally { resumed?.shutdown(); f.close(); }
});
test('periodic sweeps rotate beyond the first batch instead of starving old notes', async () => {
  const seen: string[][] = [];
  const f = fixture(async (_s, prompt) => { seen.push(JSON.parse(prompt.slice(prompt.indexOf('\n') + 1)).notes.map((n: any) => n.id)); return { summary: 'Reviewed', actions: [] }; });
  try {
    for (let i = 0; i < 4; i++) save(f.memory, `note-${i}`, `Pool fact ${i}`);
    f.service.configure({ ...DEFAULT_CURATOR_SETTINGS, enabled: true, maxNotes: 2 });
    await f.service.run(); f.advance(1000); await f.service.run(); f.advance(1000); await f.service.run();
    assert.equal(new Set(seen.slice(0, 2).flat()).size, 4); assert.deepEqual(seen[2], seen[0]);
  } finally { f.close(); }
});
test('journal write failures do not apply archive recommendations or consume pending work', async () => {
  const f = fixture(async () => ({ summary: 'Archived', actions: [{ action: 'archive', id: 'one', target: '', reason: 'Superseded', evidence: [] }] }));
  try {
    save(f.memory, 'one', 'Pool maximum is 20');
    const originalSave = f.memory.journal.save.bind(f.memory.journal);
    let saves = 0;
    f.memory.journal.save = () => { if (++saves === 2) throw Error('Disk unavailable'); originalSave(); };
    await f.service.run(); assert.equal(f.service.state().runs[0].status, 'failed'); assert.equal(f.service.state().pending, 1);
    assert.equal(f.memory.get('one')?.curation?.status, 'active');
    assert.equal(new CuratorMemory(f.dir).get('one')?.curation?.status, 'active');
  } finally { f.close(); }
});

test('exact deduplication preserves case-sensitive facts and reserved-looking note IDs are ordinary data', async () => {
  const f = fixture();
  try {
    save(f.memory, '__proto__', 'Use DATABASE_URL'); save(f.memory, 'constructor', 'Use database_url');
    await f.service.run(); assert.equal(f.memory.get('__proto__')?.curation?.status, 'active'); assert.equal(f.memory.get('constructor')?.curation?.status, 'active');
    const reloaded = new CuratorMemory(f.dir); assert.equal(reloaded.get('__proto__')?.content, 'Use DATABASE_URL');
    assert.equal(f.service.history('__proto__').length, 1); assert.equal(Object.getPrototypeOf(f.memory.journal.data.records), Object.prototype);
  } finally { f.close(); }
});

test('an abandoned scheduled run retries on restart even when the next periodic deadline is far away', async () => {
  const f = fixture(); let restarted: LoreCurator | undefined;
  try {
    save(f.memory, 'one', 'Pool maximum is 20');
    f.memory.journal.data.settings = { ...DEFAULT_CURATOR_SETTINGS, enabled: true, intervalMinutes: 43200 };
    f.memory.journal.data.nextRunAt = Date.now() + 30 * 86400000;
    f.memory.journal.data.runs.push({ id: 'abandoned', startedAt: Date.now() - 60000, trigger: 'schedule', provider: 'claude', status: 'running', summary: 'Interrupted', changed: 0, skipped: 0 });
    f.memory.journal.save(); f.service.shutdown();
    const loaded = new CuratorMemory(f.dir); let calls = 0;
    restarted = new LoreCurator('floor', f.dir, loaded, 'unused', () => {}, { timer: false, providers: ['claude'], agent: async () => { calls++; return { summary: 'Recovered', actions: [] }; }, evidence: async () => evidence });
    await restarted.tick(); assert.equal(calls, 1); assert.equal(restarted.state().runs[0].trigger, 'retry'); assert.equal(restarted.state().runs[0].status, 'completed');
  } finally { restarted?.shutdown(); f.close(); }
});

test('failed settings and restore writes preserve the current schedule and archive in memory', async () => {
  const f = fixture(async () => ({ summary: 'Archived', actions: [{ action: 'archive', id: 'one', target: '', reason: 'Obsolete fact', evidence: [] }] }));
  try {
    save(f.memory, 'one', 'Pool maximum is 20'); await f.service.run();
    const settings = f.service.state().settings;
    const originalSave = f.memory.journal.save.bind(f.memory.journal);
    f.memory.journal.save = () => { throw Error('Disk unavailable'); };
    assert.throws(() => f.service.configure({ ...settings, schedule: 'daily' }), /Disk unavailable/);
    assert.deepEqual(f.service.state().settings, settings);
    assert.throws(() => f.service.restore('one'), /Disk unavailable/); assert.equal(f.memory.get('one')?.curation?.status, 'archived');
    f.memory.journal.save = originalSave;
    assert.equal(new CuratorMemory(f.dir).get('one')?.curation?.status, 'archived');
  } finally { f.close(); }
});

test('completion evidence includes core validation and tests despite a referenced integration test and crowded filenames', async () => {
  const f = fixture();
  try {
    execFileSync('git', ['init'], { cwd: f.dir, stdio: 'ignore' });
    mkdirSync(path.join(f.dir, 'src/server'), { recursive: true }); mkdirSync(path.join(f.dir, 'tests'));
    writeFileSync(path.join(f.dir, 'src/server/completion.ts'), "if (!Array.isArray(body.files)) throw Error('files must be an array');\nif (!body.files.length && !body.filesNote) throw Error('Explain no changes');");
    writeFileSync(path.join(f.dir, 'tests/completion.test.ts'), '// filler header\n'.repeat(400) + "assert.throws(() => readCompletion({filesNote: 'No edits'}));\nreadCompletion({files: [], filesNote: 'No edits'});\n");
    writeFileSync(path.join(f.dir, 'tests/completion-server.test.ts'), 'submitCompletion({files: ["src/api.ts"]});');
    for (let i = 0; i < 12; i++) writeFileSync(path.join(f.dir, `tests/completion-server-adapter-${i}.test.ts`), '// unrelated lifecycle fixture');
    execFileSync('git', ['add', '.'], { cwd: f.dir });
    execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-m', 'fixture'], { cwd: f.dir, stdio: 'ignore' });
    const note = save(f.memory, 'one', 'Completion CLI rejects omitted files; use files: [] and filesNote for no changes. Earlier evidence: tests/completion-server.test.ts', 'Completion files-array requirement');
    const e = await repositoryEvidence(f.dir, [note]);
    assert.ok(e.files.some(x => x.path === 'src/server/completion.ts' && x.excerpt.includes('Array.isArray')));
    const unit = e.files.find(x => x.path === 'tests/completion.test.ts'); assert.ok(unit);
    assert.ok(unit.excerpt.includes('filesNote')); assert.ok(unit.excerpt.includes('assert.throws'));
    assert.ok(e.files.length <= 8); assert.ok(e.files.every(x => x.excerpt.length <= 4000));
  } finally { f.close(); }
});
