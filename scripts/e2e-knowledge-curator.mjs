import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { KnowledgeStore } from '../src/server/knowledge/store.ts';
import { KnowledgeCurator } from '../src/server/knowledge/curator.ts';
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'knowledge-curator-e2e-')); const checkout = path.join(temp, 'project'); fs.mkdirSync(checkout);
const git = (args, cwd = checkout) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
let curator;
try {
  git(['init', '-b', 'main']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.test']);
  const store = new KnowledgeStore(checkout); store.seed(); store.write('project/a.md', { title: 'Build', summary: 'Run build' }, 'Identical durable fact', 'worker:fixture'); store.write('project/b.md', { title: 'Build duplicate', summary: 'Run build again' }, 'Identical durable fact', 'worker:fixture');
  git(['add', '.gitignore', '.agent-office/knowledge']); git(['commit', '-m', 'seed']); git(['init', '--bare', path.join(temp, 'origin.git')]); git(['remote', 'add', 'origin', path.join(temp, 'origin.git')]); git(['push', '-u', 'origin', 'main']);
  let published;
  curator = new KnowledgeCurator('fixture', checkout, 'claude', () => {}, { timer: false, agent: async () => ({ summary: 'Fixture reviewed remaining notes', actions: [] }), publishBranch: (dir, branch) => { git(['push', 'origin', branch], dir); published = { branch, pr: 'https://github.com/fixture/project/pull/123' }; return published.pr; } });
  await curator.run(); assert.equal(curator.state().runs[0].status, 'completed', curator.state().runs[0].summary); assert.ok(published.branch.startsWith('agent-office/knowledge-curation/'));
  assert.match(curator.state().runs[0].summary, /pull\/123/); assert.equal(git(['branch', '--show-current']), 'main');
  assert.match(git(['show', `${published.branch}:.agent-office/knowledge/project/b.md`]), /status: "archived"/);
  assert.equal(store.tree().find(n => n.path === 'project/b.md').frontmatter.status, 'active');
  console.log('PASS: curator changes isolated on branch, duplicate archived, fixture MR published');
} finally { curator?.shutdown(); fs.rmSync(temp, { recursive: true, force: true }); }
