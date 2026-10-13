import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { KnowledgeStore } from '../src/server/knowledge/store.js';
import { lintKnowledge } from '../src/server/knowledge/lint.js';
import { fingerprint } from '../src/server/lore-curator/journal.js';
import { migrateKnowledge } from '../src/server/knowledge/migrate.js';
import { parseKnowledgeIndex, parseKnowledgeNote, serializeKnowledgeIndex } from '../src/shared/knowledge-index.js';
import { knowledgeBootstrapContext, scoreKnowledgeHint } from '../src/shared/worker-knowledge.js';
import { knowledgeReviewGate, writeHandover, knowledgeMrSection } from '../src/server/knowledge/worker.js';
import { parseKnowledgeActions, applyKnowledgeActions, curationBatch } from '../src/server/knowledge/curation.js';
import type { WorkerInfo } from '../src/shared/protocol.js';
import type { CompletionReport } from '../src/shared/completion.js';
function fixture(t: { after(fn: () => void): void }) { const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true })); const store = new KnowledgeStore(dir); store.seed(); return store; }
const frontmatter = { title: 'Build the project', summary: 'Run npm run build to compile the project', tags: ['ci', 'ts'], paths: ['src/**'], pinned: true };
test('seed, write, move and archive generate sorted indexes and preserve metadata', t => {
  const store = fixture(t); assert.equal(lintKnowledge(store).errors.length, 0);
  store.write('modules/server/build.md', { ...frontmatter, sources: ['PR #123'], status: 'needs-verification' }, 'npm run build\n' + 'full body\n'.repeat(300), 'worker:ada');
  assert.match(store.index('modules/server'), /build.md.*\[status: needs-verification\]/);
  store.write('modules/server/build.md', { title: 'Build changed', summary: 'New summary' }, 'Changed body', 'human:tester');
  const edited = parseKnowledgeNote(store.read('modules/server/build.md').text);
  assert.equal(edited.frontmatter.status, 'needs-verification'); assert.deepEqual(edited.frontmatter.sources, ['PR #123']);
  store.move('modules/server/build.md', 'project/build.md'); assert.doesNotMatch(store.index('modules/server'), /build.md/);
  store.archive('project/build.md', 'Replaced with another command', 'worker:ada');
  assert.equal(parseKnowledgeIndex(store.index('project')).archived[0].path, 'build.md'); assert.equal(lintKnowledge(store).errors.length, 0);
  assert.throws(() => store.write('project/build.md', frontmatter, 'x'.repeat(65536), 'worker:ada'), /split/);
});
test('path and credential guards reject traversal, symlinks, metadata access and secrets', t => {
  const store = fixture(t);
  for (const p of ['../escape.md', '/tmp/a.md', '_meta/state/reviews.md', 'a.json', 'dir/../a.md', 'dir\\a.md']) assert.throws(() => store.resolve(p, true));
  fs.symlinkSync(os.tmpdir(), path.join(store.root, 'symlink')); assert.throws(() => store.write('symlink/escape.md', frontmatter, 'Body', 'worker:ada'), /symlink/);
  fs.unlinkSync(path.join(store.root, 'symlink'));
  assert.throws(() => store.write('project/secret.md', frontmatter, 'token=abcdefghijklmnop', 'worker:ada'), /credentials/);
  assert.throws(() => store.write('project/INDEX.md', frontmatter, 'Body', 'worker:ada'), /Indexes/);
});
test('system symlink ancestors outside the checkout are allowed', t => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-symlink-parent-')); t.after(() => fs.rmSync(temp, { recursive: true, force: true }));
  const real = path.join(temp, 'real'); const alias = path.join(temp, 'alias');
  fs.mkdirSync(path.join(real, 'checkout'), { recursive: true }); fs.symlinkSync(real, alias, 'junction');
  const store = new KnowledgeStore(path.join(alias, 'checkout')); store.seed();
  assert.ok(fs.existsSync(path.join(real, 'checkout', '.agent-office/knowledge/INDEX.md')));
});
test('read is complete by default, paging is explicit and search returns bounded context', t => {
  const store = fixture(t); store.write('project/build.md', frontmatter, 'before\nneedle\nafter\ntail\n', 'worker:ada');
  const full = store.read('project/build.md'); assert.match(full.text, /tail\n$/);
  const page = store.read('project/build.md', 0, 2); assert.equal(page.text.split('\n').length, 2); assert.equal(page.nextOffset, 2);
  const hits = store.search('needle'); assert.equal(hits.hits.length, 1); assert.deepEqual(hits.hits[0].lines, ['before', 'needle', 'after']);
  assert.equal(store.usage()['project/build.md'], 2);
});
test('index round trip is canonical, sorted and rejects mismatched directory links and duplicates', () => {
  const text = '---\nkind: index\nsummary: Navigation\n---\n# Project\n\nProse remains.\n\n## Entries\n- [z.md](z.md) — Z\n- [a/](a/INDEX.md) — A [tags: ci] [pinned]\n';
  const canonical = serializeKnowledgeIndex(parseKnowledgeIndex(text)); assert.ok(canonical.indexOf('[a/]') < canonical.indexOf('[z.md]'));
  assert.equal(serializeKnowledgeIndex(parseKnowledgeIndex(canonical)), canonical);
  assert.throws(() => parseKnowledgeIndex(text.replace('a/INDEX.md', 'a/other.md')));
  assert.throws(() => parseKnowledgeIndex(text + '- [z.md](z.md) — Duplicate\n'));
});
test('lint fixes index drift and never rewrites a corrupt note', t => {
  const store = fixture(t); store.write('project/build.md', frontmatter, 'Body', 'worker:ada');
  const indexFile = store.resolve('project/INDEX.md'); fs.writeFileSync(indexFile, store.index('project').replace(/^- .*\n/m, ''));
  assert.ok(lintKnowledge(store).errors.length); assert.deepEqual(lintKnowledge(store, true).fixed, ['project/INDEX.md']);
  fs.writeFileSync(store.resolve('project/build.md'), 'corrupt content'); assert.ok(lintKnowledge(store, true).errors.length);
  assert.equal(fs.readFileSync(store.resolve('project/build.md'), 'utf8'), 'corrupt content');
  fs.unlinkSync(store.resolve('INDEX.md')); assert.match(lintKnowledge(store).errors[0], /missing root/);
  assert.ok(lintKnowledge(store, true).fixed.includes('INDEX.md')); assert.ok(fs.existsSync(store.resolve('INDEX.md')));
});
test('bootstrap never injects bodies, respects budget, labels verification and ranks short tokens, globs and recency', () => {
  const now = Date.now();
  const recent = { path: 'project/build.md', frontmatter: { ...frontmatter, updated: new Date(now).toISOString(), pinned: false } };
  const old = { path: 'project/old.md', frontmatter: { ...recent.frontmatter, updated: '2020-01-01' } };
  assert.ok(scoreKnowledgeHint(recent, 'ci', 0, now) > scoreKnowledgeHint(old, 'ci', 0, now));
  assert.ok(scoreKnowledgeHint(recent, 'Change src/server/hooks.ts', 0, now) > scoreKnowledgeHint(recent, 'irrelevant', 0, now));
  const root = '---\nkind: index\nsummary: Root\n---\n# Knowledge\n\n## Entries\n' + Array.from({ length: 80 }, (_, i) => `- [note-${i}.md](note-${i}.md) — entry ${i}`).join('\n');
  const block = knowledgeBootstrapContext('ci', { rootIndex: root, notes: [{ ...recent, frontmatter: { ...recent.frontmatter, status: 'needs-verification' } }, { path: 'pinned.md', frontmatter }], budget: 1600 });
  assert.ok(block.length <= 1600); assert.match(block, /more entries omitted/); assert.match(block, /Pinned: pinned.md/); assert.ok(!block.endsWith('entry'));
});
const worker = { id: 'ada', name: 'Ada', kind: 'agent', deskId: 'desk-1', completionRevision: 1, prompt: 'Build task' } as WorkerInfo;
const report = { revision: 1, summary: 'Summary', checks: [{ name: 'Test', status: 'passed', evidence: 'full evidence '.repeat(100) }], files: ['src/file.ts'], pr: 'https://github.com/example/repo/pull/123', branch: 'task', commit: 'abcdef123', status: 'ready', submittedAt: 1 } as CompletionReport;
test('required gate prompts once per revision, preserves full handover tail and accepts recorded review', t => {
  const store = fixture(t); assert.match(knowledgeReviewGate(store, worker, report)!, /Review git diff/);
  store.review(worker.id, 1, [], 'No durable facts changed'); assert.equal(knowledgeReviewGate(store, worker, report), undefined);
  const file = writeHandover(store, worker, report); const text = fs.readFileSync(file, 'utf8'); assert.match(text, /abcdef123/); assert.match(text, /pull\/123/); assert.ok(text.includes(report.checks[0].evidence));
  const mtime = fs.statSync(file).mtimeMs; writeHandover(store, worker, report); assert.equal(fs.statSync(file).mtimeMs, mtime);
  assert.match(knowledgeReviewGate(store, { ...worker, completionRevision: 2 }, { ...report, revision: 2 })!, /Review git diff/);
  assert.equal(knowledgeReviewGate(store, { ...worker, completionRevision: 2 }, report), undefined);
  assert.match(fs.readFileSync(path.join(store.checkout, store.config.handoversDir, 'ada-2.md'), 'utf8'), /Knowledge review missing/);
});
test('prompt and off policies accept completion; empty reviews need an explicit reason', t => {
  const base = fixture(t); const prompt = new KnowledgeStore(base.checkout, { reviewPolicy: 'prompt' });
  assert.equal(knowledgeReviewGate(prompt, worker, report), undefined);
  assert.match(fs.readFileSync(path.join(base.checkout, base.config.handoversDir, 'ada-1.md'), 'utf8'), /missing/);
  assert.equal(knowledgeReviewGate(new KnowledgeStore(base.checkout, { reviewPolicy: 'off' }), worker, report), undefined);
  assert.throws(() => base.review('ada', 1, []), /none_reason/);
});
test('office commit mode commits only knowledge on the task branch and produces MR section', t => {
  const base = fixture(t); const git = (args: string[]) => execFileSync('git', args, { cwd: base.checkout, encoding: 'utf8' });
  git(['init', '-b', 'task']); git(['config', 'user.name', 'Test']); git(['config', 'user.email', 'test@example.test']); git(['add', '.gitignore']); git(['commit', '-m', 'fixture']);
  const store = new KnowledgeStore(base.checkout, { commitMode: 'office' }); store.write('project/build.md', frontmatter, 'npm run build', 'worker:ada'); store.review('ada', 1, ['project/build.md']);
  assert.equal(knowledgeReviewGate(store, worker, report), undefined); assert.match(git(['log', '-1', '--format=%s']), /knowledge:/);
  assert.match(knowledgeMrSection(store, ['project/build.md']), /project\/build.md.*Run npm run build/);
});
test('migration is idempotent, maps status and provenance, keeps original JSON and full journals', t => {
  const store = fixture(t); const legacy = path.join(store.checkout, '.agent-office/lore'); fs.mkdirSync(legacy, { recursive: true });
  fs.writeFileSync(path.join(legacy, 'active.json'), JSON.stringify({ title: 'Old knowledge', content: 'Full content', status: 'needs-verification', sources: ['PR #123'], updatedAt: Date.parse('2020-01-01'), author: 'Ada' }));
  fs.writeFileSync(path.join(legacy, 'handover.json'), JSON.stringify({ id: 'handover-123', title: 'Handover', content: 'full journal '.repeat(1500), tags: ['handover'] }));
  fs.writeFileSync(path.join(legacy, 'archive.json'), JSON.stringify({ title: 'Archived knowledge', content: 'Old fact', status: 'superseded' }));
  const first = migrateKnowledge(store); assert.equal(first.imported.length, 3); assert.equal(first.errors.length, 0); assert.equal(first.lint.errors.length, 0);
  assert.equal(migrateKnowledge(store).imported.length, 0); assert.equal(fs.readdirSync(legacy).length, 3);
  const imported = store.tree().find(n => n.frontmatter?.title === 'Old knowledge')!; assert.equal(imported.frontmatter?.updated, '2020-01-01'); assert.deepEqual(imported.frontmatter?.sources, ['PR #123']);
});
test('curation validates whole action sets, rejects journal edits and skips concurrent note edits', t => {
  const store = fixture(t); store.write('project/a.md', frontmatter, 'Body', 'worker:ada'); const batch = curationBatch(store, 20);
  const value = { summary: 'Review', actions: [{ action: 'archive', path: 'project/a.md', reason: 'Obsolete' }] };
  assert.equal(parseKnowledgeActions(value, batch, []).actions.length, 1);
  assert.throws(() => parseKnowledgeActions({ ...value, actions: [...value.actions, { ...value.actions[0], path: 'outside.md' }] }, batch, []));
  store.write('project/a.md', frontmatter, 'Concurrent edit', 'human:tester'); assert.equal(applyKnowledgeActions(store, batch, value.actions as never, 'abcdef123').skipped, 1);
  const handover = { path: 'handovers/ada.md', frontmatter, body: 'Journal', version: 'Journal', handover: true };
  assert.throws(() => parseKnowledgeActions({ summary: '', actions: [{ action: 'archive', path: handover.path, reason: 'Old' }] }, [handover], []), /read-only/);
});

test('migration preserves a matching legacy curator overlay', t => {
  const store = fixture(t); const legacy = path.join(store.checkout, '.agent-office/lore'); fs.mkdirSync(legacy, { recursive: true });
  const note = { id: 'legacy-note', title: 'Legacy title', content: 'Original body', author: 'Ada', tags: ['ci'], createdAt: 1, updatedAt: 2 };
  fs.writeFileSync(path.join(legacy, 'note.json'), JSON.stringify(note));
  fs.writeFileSync(path.join(store.checkout, '.agent-office/lore-curator.json'), JSON.stringify({ records: { 'legacy-note': { fingerprint: fingerprint(note), title: 'Curated title', content: 'Curated body', meta: { status: 'archived', sources: ['PR 123'] } } } }));
  assert.equal(migrateKnowledge(store).errors.length, 0);
  const imported = store.tree().find(n => n.frontmatter?.title === 'Curated title')!;
  assert.equal(imported.frontmatter?.status, 'archived'); assert.deepEqual(imported.frontmatter?.sources, ['PR 123']);
  assert.match(store.read(imported.path).text, /Curated body/);
});
