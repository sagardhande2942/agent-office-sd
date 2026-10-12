import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { repositoryEvidence } from '../src/server/lore-curator/evidence';
import type { LoreNote } from '../src/shared/protocol/lore';

function fixture(t: { after(fn: () => void): void }, files: Record<string, string>) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'curator-evidence-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q'], { cwd: dir });
  execFileSync('git', ['config', 'core.autocrlf', 'false'], { cwd: dir });
  for (const [name, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, name)), { recursive: true });
    writeFileSync(path.join(dir, name), content);
  }
  execFileSync('git', ['add', '.'], { cwd: dir });
  execFileSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.test', 'commit', '-qm', 'fixture'], { cwd: dir });
  return dir;
}
const note = (id: string, content: string): LoreNote => ({ id, title: id, content, tags: [], author: 'test', createdAt: 0, updatedAt: 0 });

test('a batch includes each note’s referenced implementation and test beyond eight files', async t => {
  const files: Record<string, string> = {};
  const notes = Array.from({ length: 12 }, (_, i) => {
    files[`src/feature-${i}.ts`] = `export const feature${i} = ${i};`;
    files[`tests/feature-${i}.test.ts`] = `assert.equal(feature${i}, ${i});`;
    return note(`discovery-${i}`, `Implemented src/feature-${i}.ts, covered by tests/feature-${i}.test.ts.`);
  });
  const result = await repositoryEvidence(fixture(t, files), notes);
  assert.deepEqual(new Set(result.files.map(f => f.path)), new Set(Object.keys(files)));
});

test('medium files retain the entire implementation rather than only three short windows', async t => {
  const content = 'const visibility = true;\n'.repeat(240) + 'export const finalVisibilityEvidence = visibility;';
  const result = await repositoryEvidence(fixture(t, { 'src/visibility.ts': content }), [note('visibility', 'See src/visibility.ts for visibility initialization.')]);
  assert.equal(result.files[0].excerpt, content);
  assert.equal(result.files[0].truncated, undefined);
});

test('oversized files do not erase usable evidence and secrets or dirty changes remain excluded', async t => {
  const dir = fixture(t, { 'src/giant.ts': 'x'.repeat(3 * 1024 * 1024), 'src/visibility.ts': 'export const visible = true;', 'secrets.json': '{"token":"private-secret"}' });
  writeFileSync(path.join(dir, 'src/visibility.ts'), 'export const visible = false;');
  const result = await repositoryEvidence(dir, [note('visibility', 'src/giant.ts and src/visibility.ts; secrets.json')]);
  assert.deepEqual(result.files.map(f => f.path), ['src/visibility.ts']);
  assert.match(result.files[0].excerpt, /true/);
});

test('large batches keep file, excerpt and total text limits and identify omissions', async t => {
  const files = Object.fromEntries(Array.from({ length: 30 }, (_, i) => [`src/feature-${i}.ts`, `// feature ${i}\n`.repeat(1400)]));
  const result = await repositoryEvidence(fixture(t, files), Object.keys(files).map((p, i) => note(`note-${i}`, p)));
  assert.ok(result.files.length > 0 && result.files.length <= 24);
  assert.ok(result.files.every(f => f.excerpt.length <= 8000 && f.truncated));
  assert.ok(result.files.reduce((sum, f) => sum + f.excerpt.length, 0) <= 96000);
});
