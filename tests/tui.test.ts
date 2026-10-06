import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { plain } from '../src/server/tui.js';
import { renderDashboard, seats, type Dashboard } from '../src/server/tui-dashboard.js';
import type { FloorView, WorkerInfo } from '../src/shared/protocol.js';

test('dashboard labels cannot inject terminal control sequences', () => {
  assert.equal(plain('\x1b[2Jname\n\x1b]0;title\x07\x9b'), 'name');
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

const view = {
  floor: 'test', project: { dir: '/project' }, plan: { wing: 1, labels: {} },
  workers: [{ id: 'w1', deskId: 'desk-1', name: 'Ada', status: 'needs_input', provider: 'codex' } as WorkerInfo],
  issues: { items: [{ number: 12, title: 'Fix login' }] }, pulls: { items: [] }, queue: { tasks: [] },
} as unknown as FloorView;
const state: Dashboard = { view, floors: [], selected: 0, offset: 0, panel: 'office', notice: '' };

test('dashboard includes empty desks, expanded wing and workers away from desks', () => {
  const expanded = { ...view, workers: [...view.workers, { id: 'helper', deskId: 'helper-1', name: 'Helper' } as WorkerInfo] };
  const grid = seats(expanded);
  assert.equal(grid.length, 19);
  assert.ok(grid.some((s) => s.id === 'desk-18'));
  assert.equal(grid.filter((s) => s.worker).length, 2);
});

test('dashboard keeps selected desk visible across sizes without overflowing rows', () => {
  for (const [width, height] of [[120, 30], [80, 24], [32, 12]]) {
    const rendered = renderDashboard({ ...state, selected: 17 }, width, height);
    const lines = rendered.split('\r\n');
    assert.equal(lines.length, height);
    assert.ok(lines.every((line) => plain(line).length <= width));
    assert.ok(plain(rendered).includes(seats(view)[17].label));
  }
});

test('boards scroll and titles cannot emit terminal controls', () => {
  const rendered = renderDashboard({ ...state, panel: 'issues' }, 80, 24);
  assert.match(rendered, /#12  Fix login/);
  const malicious = { ...state, notice: '\x1b[2Jbad\x1b]0;title\x07' };
  assert.ok(!renderDashboard(malicious, 80, 24).includes('title'));
  const scrolled = renderDashboard({ ...state, panel: 'issues', offset: 1 }, 80, 24);
  assert.ok(!scrolled.includes('Fix login'));
});

test('empty office stays within a narrow terminal', () => {
  const rendered = renderDashboard({ ...state, view: undefined }, 24, 12);
  assert.ok(rendered.split('\r\n').every((line) => plain(line).length <= 24));
  assert.equal(plain('नमस्ते'), 'नमस्ते', 'prompt text preserves Unicode');
});

test('send-home choices stay visible in a small terminal', () => {
  const worker = { ...view.workers[0], worktree: { path: '/project/ada', branch: 'office/ada', base: 'main' } };
  for (const [width, height] of [[120, 30], [80, 24], [32, 12]]) {
    const rendered = renderDashboard({ ...state, home: { worker, cleanup: 'keep' } }, width, height);
    assert.match(rendered, /1\. Delete worktree \+ branch/);
    assert.match(rendered, /2\. Delete worktree only/);
    assert.match(rendered, /> 3\. Keep both/);
    assert.equal(rendered.split('\r\n').length, height);
    assert.ok(rendered.split('\r\n').every((line) => plain(line).length <= width));
  }
});
