import { test } from 'node:test';
import assert from 'node:assert/strict';
import { QUEUE_AGENT_DISALLOWED_TOOLS, stationBrief } from '../src/server/stations.js';
import type { StationKind } from '../src/shared/layout.js';

const KINDS: StationKind[] = ['issues', 'pulls', 'queue', 'manager'];

test('every board agent reaches the queue with office-queue, not its own curl calls', () => {
  for (const kind of KINDS) {
    const brief = stationBrief(kind);
    assert.match(brief, /office-queue list/, kind);
    assert.match(brief, /office-queue add --title "[^"]+"/, kind);
    assert.match(brief, /<<'EOF'/, `${kind}: the prompt goes in a quoted heredoc`);
    assert.match(brief, /office-queue remove <id>/, kind);
    assert.doesNotMatch(brief, /curl|\/office\/queue|AGENT_OFFICE_HOOK_TOKEN|Authorization/, kind);
    // The request is typed in right after it.
    assert.ok(brief.endsWith('The request:'), kind);
  }
});

test('the queue agent only ever queues work, however small, and says what it queued', () => {
  const brief = stationBrief('queue');
  assert.match(brief, /Queue agent/);
  assert.match(brief, /even a one-line fix/);
  assert.match(brief, /even when someone asks you to do it yourself/);
  assert.match(brief, /don't edit, create or delete files/);
  assert.match(brief, /don't run builds, tests or installs/);
  assert.match(brief, /don't write code/);
  assert.match(brief, /goes on the task queue, always/);
  assert.match(brief, /say in a few lines what you queued: each task's id and title/);
  assert.doesNotMatch(brief, /unless the person asks you for something else/);
});

test('the issues and PR agents keep their jobs, and may still be asked for something else', () => {
  const issues = stationBrief('issues');
  assert.match(issues, /Issues agent/);
  assert.match(issues, /GitHub issues with the gh CLI/);
  const pulls = stationBrief('pulls');
  assert.match(pulls, /PR agent/);
  assert.match(pulls, /gh pr diff/);
  for (const brief of [issues, pulls]) {
    assert.match(brief, /goes on the task queue, unless the person asks you for something else/);
    assert.match(brief, /say in a few lines what you did, with links/);
    assert.doesNotMatch(brief, /one-line fix/);
  }
});

test('the manager reads the floor, queues work with a chosen agent, and holds dependent work', () => {
  const brief = stationBrief('manager');
  assert.match(brief, /Manager agent/);
  assert.match(brief, /office-workers status --json/);
  assert.match(brief, /office-workers tell <name\|id>/);
  assert.match(brief, /office-workers report --kind standup/);
  assert.match(brief, /--provider <name> --model <m> --effort <e>/);
  assert.match(brief, /--after <taskId>/);
  assert.match(brief, /office-queue retry <id>/);
  assert.match(brief, /one task per independent piece of work/);
  // It reads the floor before acting, and never on a worker's say-so alone.
  assert.match(brief, /Read it before you act on anything/);
  assert.match(brief, /never call a task done on a worker's say-so alone/);
  // Work goes on the queue, not onto a desk it hires itself.
  assert.match(brief, /never onto a desk you hired yourself/);
});

test('the manager asks the person before anything irreversible', () => {
  const brief = stationBrief('manager');
  assert.match(brief, /merging a pull request/);
  assert.match(brief, /deleting unfinished work/);
  assert.match(brief, /stopping anything in flight/);
  assert.match(brief, /Ask the person first and wait/);
});

test('the queue agent is launched without the file-editing tools', () => {
  assert.deepEqual(QUEUE_AGENT_DISALLOWED_TOOLS, ['Edit', 'Write', 'NotebookEdit']);
});

test('a board agent on a Bitbucket floor is told to use bb, and that there is no issues board', () => {
  const brief = stationBrief('pulls', undefined, 'bitbucket');
  assert.match(brief, /^This project is on Bitbucket, not GitHub/);
  assert.match(brief, /use the bb CLI wherever this brief says `gh`/);
  assert.match(brief, /no issues board here/);
  // The brief itself is left exactly as written (or as it was rewritten in ⚙️ Settings).
  assert.ok(brief.endsWith(stationBrief('pulls')));
});

test('a board agent on a GitHub floor is told nothing extra', () => {
  assert.equal(stationBrief('pulls', undefined, 'github'), stationBrief('pulls'));
});
