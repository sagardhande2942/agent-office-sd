import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { originRepo, repoArgs, saidOf, workRepo } from '../src/server/forge.js';
import { Claims, closesIn } from '../src/server/github.js';

// A floor works on the repository its origin points at, so a fork's boards and pull requests are its
// own. The gong, which both forges share, is tested in tests/bitbucket.test.ts.

test('a forked checkout is worked on as the fork, not the repository it was forked from', (t) => {
  const root = mkdtempSync(path.join(tmpdir(), 'office-github-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-q', '-b', 'main', 'fork');
  const fork = path.join(root, 'fork');
  const checkout = (...args: string[]) => execFileSync('git', args, { cwd: fork, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  checkout('remote', 'add', 'origin', 'git@github.com:sagardhande2942/agent-office-sd.git');
  // What forking looks like: origin is yours, upstream is where it came from. gh, asked about this
  // checkout, would answer for upstream, which is what the boards used to fill themselves with.
  checkout('remote', 'add', 'upstream', 'https://github.com/example-owner/office-fixture.git');
  delete process.env.GH_REPO;
  assert.equal(workRepo(fork), 'sagardhande2942/agent-office-sd', 'the boards and pull requests are on the repository origin points at');
  // A checkout with no origin on GitHub is left to gh, to answer or to say why it can't.
  assert.equal(workRepo(root), undefined);
  checkout('remote', 'set-url', 'origin', 'https://gitlab.com/o/r.git');
  assert.equal(originRepo(fork), undefined, 'a remote off GitHub names no repository');
  // Started with GH_REPO, the office works on the repository that names.
  process.env.GH_REPO = 'github.com/example-owner/office-fixture';
  try {
    assert.equal(workRepo(fork), 'example-owner/office-fixture');
  } finally {
    delete process.env.GH_REPO;
  }
});

test('every gh call is told which repository it is about', () => {
  const list = ['pr', 'list', '--state', 'open'];
  assert.deepEqual(repoArgs(list, 'o/r'), ['pr', 'list', '--state', 'open', '--repo', 'o/r']);
  assert.deepEqual(repoArgs(list, undefined), list, 'with no repository, gh is left to answer as it would');
  // gh api has no --repo: the name goes in the path, and the flags around it are left alone.
  assert.deepEqual(repoArgs(['api', '--method', 'POST', 'repos/{owner}/{repo}/issues/5/comments', '-f', 'body=hi', '--jq', '.id'], 'o/r'), [
    'api',
    '--method',
    'POST',
    'repos/o/r/issues/5/comments',
    '-f',
    'body=hi',
    '--jq',
    '.id',
  ]);
  assert.deepEqual(repoArgs(['api', 'user', '--jq', '.login'], 'o/r'), ['api', 'user', '--jq', '.login'], 'about who we are, not about a repository');
  // gh repo view takes the repository as an argument, and this checkout's already named when asked.
  assert.deepEqual(repoArgs(['repo', 'view', '--json', 'nameWithOwner'], 'o/r'), ['repo', 'view', 'o/r', '--json', 'nameWithOwner']);
  assert.deepEqual(repoArgs(['repo', 'view', 'o/other', '--json', 'nameWithOwner'], 'o/r'), ['repo', 'view', 'o/other', '--json', 'nameWithOwner']);
});

test('the issues a pull request closes are read out of its description', () => {
  // gh's --json has no closingIssuesReferences, so the list that asks for it comes back empty and the
  // whole pull request board says it couldn't load. These are the keywords GitHub itself links on.
  assert.deepEqual(closesIn('The fridge opens on E now. Fixes #7'), [7], 'the usual one');
  assert.deepEqual(closesIn('Some summary\n\nResolves #42\n\nAnd more prose.'), [42], 'on a line of its own');
  assert.deepEqual(closesIn('Closes #3 and fixes #4'), [3, 4], 'a keyword each');
  assert.deepEqual(closesIn('Fixed #5, closed #6'), [5, 6], 'the word forms of both');
  // One keyword takes the first issue named after it, as on GitHub.
  assert.deepEqual(closesIn('closes: #12, #13'), [12]);
  assert.deepEqual(closesIn('fixes #7 and again fixes #7'), [7], 'the same issue once');
  // A number with no keyword on its line is a mention, not a close.
  assert.deepEqual(closesIn('## Summary\n\n#99 is related but I am not closing it'), []);
  assert.deepEqual(closesIn('see #7 for context'), []);
  // And the keyword only counts where it really is one: not across a sentence's own words.
  assert.deepEqual(closesIn('not a fix, see #7'), []);
  assert.deepEqual(closesIn('closes #0'), [], 'there is no issue zero');
  assert.deepEqual(closesIn(''), []);
});

test("a CLI's failure is read where it says why, not off the end of it", () => {
  // gh answers an unknown --json field with the reason and then an alphabet of every field it does
  // know. Reading the last lines of that leaves the board blaming "updatedAt url".
  const fieldError = ['Unknown JSON field: "closingIssuesReferences"', 'Available fields:', '  additions', '  author', '  updatedAt', '  url', ''].join('\n');
  assert.equal(saidOf(fieldError), 'Unknown JSON field: "closingIssuesReferences"');
  // A plain one-line failure is itself.
  assert.equal(saidOf("the 'o/r' repository has disabled issues"), "the 'o/r' repository has disabled issues");
  assert.equal(saidOf('  \n no git remotes found \n\n'), 'no git remotes found', 'read from the first line with words in it');
  assert.equal(saidOf(''), '', 'a failure that said nothing reads as nothing');
  // bb's errors arrive as a JSON envelope spread over lines, and are left whole for bbSaid to open.
  const envelope = '{\n  "name": "AuthError",\n  "code": 1001,\n  "message": "not authenticated"\n}';
  assert.equal(saidOf(envelope), envelope);
});

const issue = (number: number, assignees: string[] = []): GhIssue => ({
  number, title: `Issue ${number}`, state: 'OPEN', url: '', author: '', labels: [], assignees, createdAt: '', updatedAt: '', body: '', comments: 0,
});
const taken = (is: GhIssue[]) => is.filter((i) => i.taken).map((i) => i.number);

test('an issue a worker took is marked at once, before GitHub has answered', () => {
  const c = new Claims();
  c.take(7);
  assert.deepEqual(taken(c.mark([issue(6), issue(7)])), [7]);
  // A list that comes back while GitHub is still assigning it doesn't have its assignee yet.
  assert.deepEqual(taken(c.mark([issue(6), issue(7)], 1000)), [7]);
});

test('it stays marked over a list asked for before it was assigned, until one asked for after', () => {
  const c = new Claims();
  const answered = c.take(7);
  answered(true, 2000);
  assert.deepEqual(taken(c.mark([issue(7)], 1500)), [7], 'asked before GitHub had it assigned');
  assert.equal(c.has(7), true);
  const fresh = c.mark([issue(7, ['octocat'])], 2500);
  assert.deepEqual(taken(fresh), [], 'GitHub lists its assignee now, which is what keeps it In progress');
  assert.deepEqual(fresh[0].assignees, ['octocat']);
  assert.equal(c.has(7), false);
});

test("an issue GitHub wouldn't assign goes back to where it was", () => {
  const c = new Claims();
  const answered = c.take(7);
  const shown = c.mark([issue(7)]);
  assert.deepEqual(taken(shown), [7]);
  answered(false);
  const back = c.mark(shown);
  assert.deepEqual(taken(back), []);
  assert.equal('taken' in back[0], false);
});

test('handed over twice, the first answer failing leaves the second one standing', () => {
  const c = new Claims();
  const first = c.take(7);
  const second = c.take(7);
  first(false);
  assert.deepEqual(taken(c.mark([issue(7)])), [7]);
  second(true, 3000);
  assert.deepEqual(taken(c.mark([issue(7, ['octocat'])], 3500)), []);
});
