import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LoreStore } from '../src/server/lore.js';
import { cleanLoreTitle, cleanLoreContent, parseLoreTags, formatLoreForPrompt, LORE_TITLE_MAX, LORE_CONTENT_MAX } from '../src/shared/lore.js';

test('LoreStore saves, lists, updates, and deletes notes across disk files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lore-test-'));
  try {
    const store = new LoreStore(dir);
    assert.deepEqual(store.list(), []);

    // Save a note
    const note1 = store.save({
      title: 'Flaky Auth Tests in CI',
      content: 'Always run with TEST_PARALLEL=1 to avoid session collision.',
      author: 'Worker-42',
      desk: 'Desk 3',
      tags: ['auth', 'ci', 'flaky'],
    });

    assert.ok(note1.id);
    assert.equal(note1.title, 'Flaky Auth Tests in CI');
    assert.equal(note1.author, 'Worker-42');
    assert.equal(note1.desk, 'Desk 3');
    assert.deepEqual(note1.tags, ['auth', 'ci', 'flaky']);
    assert.ok(note1.createdAt > 0);

    const listed = store.list();
    assert.equal(listed.length, 1);
    assert.equal(listed[0].id, note1.id);

    // Save an update to the note
    const updated = store.save({
      id: note1.id,
      title: 'Flaky Auth Tests in CI (Resolved)',
      content: 'Updated fix: make sure redis container is healthy.',
      author: 'Worker-42',
      tags: ['auth', 'ci', 'fixed'],
    });

    assert.equal(updated.id, note1.id);
    assert.equal(updated.title, 'Flaky Auth Tests in CI (Resolved)');
    assert.deepEqual(updated.tags, ['auth', 'ci', 'fixed']);

    // Persists across store instances
    const store2 = new LoreStore(dir);
    const listed2 = store2.list();
    assert.equal(listed2.length, 1);
    assert.equal(listed2[0].title, 'Flaky Auth Tests in CI (Resolved)');

    // Delete
    const deleted = store2.delete(note1.id);
    assert.equal(deleted, true);
    assert.equal(store2.list().length, 0);

    // Delete non-existent
    assert.equal(store2.delete('non-existent'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('LoreStore handles corrupted files and invalid IDs safely', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lore-corrupt-test-'));
  try {
    const store = new LoreStore(dir);
    const note = store.save({
      title: 'Valid Note',
      content: 'Clean content',
      author: 'Tester',
      tags: ['test'],
    });

    // Write a corrupt JSON file in the lore directory
    const loreDir = path.join(dir, 'lore');
    writeFileSync(path.join(loreDir, 'corrupt.json'), 'not-valid-json{[[[');

    // Write a non-json file
    writeFileSync(path.join(loreDir, 'readme.txt'), 'some text');

    // Listing ignores corrupted and non-json files without crashing
    const notes = store.list();
    assert.equal(notes.length, 1);
    assert.equal(notes[0].id, note.id);

    // Directory traversal attempt is rejected
    assert.equal(store.delete('../somefile'), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('shared lore sanitization and formatting helpers', () => {
  // Title sanitization
  assert.equal(cleanLoreTitle('   Hello World   '), 'Hello World');
  assert.equal(cleanLoreTitle('a'.repeat(300)).length, LORE_TITLE_MAX);
  assert.equal(cleanLoreTitle(''), '');

  // Content sanitization
  assert.equal(cleanLoreContent('  multi\nline  '), 'multi\nline');
  assert.equal(cleanLoreContent('x'.repeat(15000)).length, LORE_CONTENT_MAX);

  // Tags parsing
  assert.deepEqual(parseLoreTags(' Auth, CI, auth, , test! '), ['auth', 'ci', 'test']);
  assert.deepEqual(parseLoreTags(['Foo', 'BAR', 'foo']), ['foo', 'bar']);

  // Format for prompt
  const formatted = formatLoreForPrompt([{
    id: '123',
    title: 'Postgres Connection Pooling',
    content: 'Always acquire client from pool within transaction.',
    author: 'Alice',
    createdAt: Date.now(),
    tags: ['db', 'perf'],
  }]);

  assert.ok(formatted.includes('Postgres Connection Pooling'));
  assert.ok(formatted.includes('Always acquire client from pool within transaction.'));
  assert.ok(formatted.includes('#db #perf'));
});
