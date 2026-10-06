import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { plain } from '../src/server/tui.js';

test('dashboard labels cannot inject terminal control sequences', () => {
  assert.equal(plain('\x1b[2Jname\n\x1b]0;title\x07\x9b'), 'name]0;title');
});

test('tui help works without a terminal or server', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/server/cli.ts', 'tui', '--help'], { encoding: 'utf8' });
  assert.equal(result.status, 0);
  assert.match(result.stdout, /Ctrl\+\]/);
});

test('tui refuses noninteractive input before prompting or connecting', () => {
  const result = spawnSync(process.execPath, ['--import', 'tsx', 'src/server/cli.ts', 'tui'], { encoding: 'utf8' });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /interactive terminal/);
});
