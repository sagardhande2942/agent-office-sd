import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';
import { promisify } from 'node:util';
import { execFile, execFileSync } from 'node:child_process';
import { KnowledgeStore, atomicWrite, rejectCredentials } from './store.js';
import { lintKnowledge } from './lint.js';

const execAsync = promisify(execFile);
const remoteGit = async (checkout: string, args: string[]) => (await execAsync('git', args, { cwd: checkout, timeout: 120000, maxBuffer: 16 * 1024 * 1024, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } })).stdout.trim();
/** Keep Git's diagnostic and process outcome, including silent timeouts and buffer failures. */
function deliveryError(error: unknown): string {
  if (!(error instanceof Error)) return String(error);
  const details = error as Error & { stderr?: string | Buffer; code?: string | number; signal?: string };
  const stderr = String(details.stderr ?? '').trim();
  return [error.message, stderr, details.code !== undefined ? `exit/code: ${details.code}` : '', details.signal ? `signal: ${details.signal}` : ''].filter(Boolean).join('\n');
}
type Snapshot = Record<string, string>;
export interface KnowledgeDelivery {
  id: string; branch: string; url?: string; state: 'preparing' | 'published' | 'merged' | 'closed' | 'failed';
  before: Snapshot; after?: Snapshot; base: Snapshot; paths?: string[]; conflicts?: string[]; error?: string;
}
export interface DeliveryOptions {
  publishBranch?: (checkout: string, branch: string) => string;
  reviewState?: (delivery: KnowledgeDelivery) => 'published' | 'merged' | 'closed';
}
export const knowledgeGit = (checkout: string, args: string[]) => execFileSync('git', ['-c', 'user.name=Agent Office', '-c', 'user.email=agent-office@localhost', '-c', 'commit.gpgSign=false', ...args], { cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 120000 }).trim();
export function knowledgeSnapshot(store: KnowledgeStore): Snapshot {
  const result: Snapshot = {};
  for (const note of store.tree()) {
    if (note.error) throw Error(`${note.path}: ${note.error}`);
    const text = fs.readFileSync(store.resolve(note.path), 'utf8').replace(/\r\n/g, '\n'); rejectCredentials(text); result[note.path] = text;
  }
  return result;
}
function revisionSnapshot(store: KnowledgeStore, revision: string): Snapshot {
  const result: Snapshot = {}; const prefix = store.config.dir.replace(/\\/g, '/').replace(/\/$/, '') + '/';
  const files = knowledgeGit(store.checkout, ['ls-tree', '-r', '--name-only', revision, '--', store.config.dir]).split('\n');
  for (const file of files) {
    const relative = file.slice(prefix.length);
    if (!file.startsWith(prefix) || !relative.endsWith('.md') || path.posix.basename(relative) === 'INDEX.md' || relative.startsWith('_meta/')) continue;
    store.resolve(relative);
    result[relative] = execFileSync('git', ['show', `${revision}:${file}`], { cwd: store.checkout, encoding: 'utf8' }).replace(/\r\n/g, '\n');
  }
  return result;
}
export function deliveries(store: KnowledgeStore): KnowledgeDelivery[] {
  let records: KnowledgeDelivery[] = [];
  store.stateUpdate('deliveries.json', data => { records = (data.records ?? []) as KnowledgeDelivery[]; });
  return records;
}
function save(store: KnowledgeStore, record: KnowledgeDelivery) {
  store.stateUpdate('deliveries.json', data => {
    const records = (data.records ?? []) as KnowledgeDelivery[];
    data.records = [...records.filter(r => r.id !== record.id), record];
  });
}
export function knowledgeForge(remote: string) {
  const match = remote.match(/^(?:https:\/\/|git@)(github\.com|gitlab\.com)[:/]([\w.-]+(?:\/[\w.-]+)+)$/);
  if (!match) throw Error('Knowledge publishing supports verified github.com or gitlab.com origin URLs');
  const repo = match[2].replace(/\.git$/, '');
  if (repo.split('/').some(part => !part || part === '.' || part === '..') || match[1] === 'github.com' && repo.split('/').length !== 2) throw Error('Invalid knowledge repository path');
  return { cli: match[1] === 'github.com' ? 'gh' : 'glab', repo };
}
function forge(store: KnowledgeStore) {
  return knowledgeForge(knowledgeGit(store.checkout, ['remote', 'get-url', 'origin']));
}
export async function prepareKnowledgeDelivery(store: KnowledgeStore, kind: 'edit' | 'curation', options: DeliveryOptions = {}) {
  if (!options.publishBranch) forge(store);
  const record = store.withLock(() => {
    const previous = deliveries(store);
    if (previous.some(r => r.state === 'preparing' || r.state === 'published')) throw Error('A knowledge review is pending. Sync its result before publishing another.');
    const base = revisionSnapshot(store, 'HEAD');
    for (const r of previous.filter(r => r.state === 'merged')) for (const p of r.paths ?? []) {
      if (r.after?.[p] === undefined) delete base[p]; else base[p] = r.after[p];
    }
    const id = randomUUID();
    const record: KnowledgeDelivery = { id, branch: `agent-office/knowledge-${kind}/${id}`, state: 'preparing', before: knowledgeSnapshot(store), base };
    save(store, record); return record;
  });
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'office-knowledge-delivery-')); const worktree = path.join(temp, 'tree');
  try {
    await remoteGit(store.checkout, ['fetch', 'origin', 'main']);
    // Checkout can be slow on mounted filesystems. Do not block the floor host or buffer progress.
    await remoteGit(store.checkout, ['worktree', 'add', '--quiet', '-b', record.branch, worktree, 'origin/main']);
    const proposal = new KnowledgeStore(worktree, store.config); proposal.seed();
    const remote = knowledgeSnapshot(proposal);
    // Overlay only local changes. Never replace the entire freshly fetched tree.
    const changed = [...new Set([...Object.keys(record.base), ...Object.keys(record.before)])].filter(p => record.base[p] !== record.before[p]);
    for (const p of changed) if (remote[p] !== record.base[p] && remote[p] !== record.before[p]) throw Error(`Knowledge conflict with origin/main: ${p}. Sync/reconcile it before publishing.`);
    for (const p of changed) {
      if (record.before[p] === undefined) fs.rmSync(proposal.resolve(p), { force: true });
      else atomicWrite(proposal.resolve(p), record.before[p]);
    }
    const lint = lintKnowledge(proposal, true); if (lint.errors.length) throw Error(lint.errors.join('\n'));
    return { record, temp, worktree, proposal };
  } catch (e) {
    record.state = 'failed'; record.error = `${deliveryError(e)}; retained at ${worktree}`; save(store, record); throw Error(record.error);
  }
}
export async function finishKnowledgeDelivery(store: KnowledgeStore, draft: Awaited<ReturnType<typeof prepareKnowledgeDelivery>>, options: DeliveryOptions = {}) {
  const { record, proposal, worktree, temp } = draft;
  try {
    const lint = lintKnowledge(proposal, true); if (lint.errors.length) throw Error(lint.errors.join('\n'));
    record.after = knowledgeSnapshot(proposal);
    record.paths = [...new Set([...Object.keys(record.before), ...Object.keys(record.after)])].filter(p => record.before[p] !== record.after![p] || record.base[p] !== record.after![p]);
    knowledgeGit(worktree, ['add', '--', store.config.dir, '.gitignore']);
    if (!knowledgeGit(worktree, ['diff', '--cached', '--name-only'])) {
      record.state = 'closed'; save(store, record); cleanup(store, draft); return { message: 'No knowledge changes to publish' };
    }
    knowledgeGit(worktree, ['commit', '-m', 'knowledge: review shared office knowledge']);
    if (options.publishBranch) record.url = options.publishBranch(worktree, record.branch);
    else {
      const { cli, repo } = forge(store);
      const body = path.join(temp, 'review.md'); atomicWrite(body, `Review shared office knowledge. The live checkout is unchanged by this proposal.\n\n## Knowledge base updates\n\n${record.paths.map(p => `- \`${p}\``).join('\n')}\n\nValidation: knowledge lint passed.\n`);
      await remoteGit(worktree, ['push', '-u', 'origin', record.branch]);
      const args = cli === 'gh' ? ['pr', 'create', '--repo', repo, '--base', 'main', '--head', record.branch, '--title', '[Knowledge] Shared office knowledge review', '--body-file', body] : ['mr', 'create', '--repo', repo, '--source-branch', record.branch, '--target-branch', 'main', '--title', '[Knowledge] Shared office knowledge review', '--description', fs.readFileSync(body, 'utf8'), '--yes'];
      record.url = (await execAsync(cli, args, { cwd: worktree, timeout: 120000 })).stdout.trim();
    }
    record.state = 'published'; save(store, record); cleanup(store, draft);
    return { message: `Knowledge review published: ${record.url}`, url: record.url };
  } catch (e) {
    failKnowledgeDelivery(store, draft, e); throw Error(record.error);
  }
}
function cleanup(store: KnowledgeStore, draft: Awaited<ReturnType<typeof prepareKnowledgeDelivery>>) {
  try { knowledgeGit(store.checkout, ['worktree', 'remove', draft.worktree]); fs.rmSync(draft.temp, { recursive: true, force: true }); }
  catch (e) { draft.record.error = `Published result retained; cleanup failed at ${draft.worktree}: ${String(e)}`; save(store, draft.record); }
}
export function failKnowledgeDelivery(store: KnowledgeStore, draft: Awaited<ReturnType<typeof prepareKnowledgeDelivery>>, e: unknown) {
  draft.record.state = 'failed'; draft.record.error = `${deliveryError(e)}; retained at ${draft.worktree}`; save(store, draft.record);
}
export async function publishKnowledge(store: KnowledgeStore, options: DeliveryOptions = {}) {
  return finishKnowledgeDelivery(store, await prepareKnowledgeDelivery(store, 'edit', options), options);
}
export async function proposeKnowledgeRevert(store: KnowledgeStore, commit: string, options: DeliveryOptions = {}) {
  if (!/^[a-f0-9]{7,40}$/i.test(commit)) throw Error('Invalid commit');
  const files = knowledgeGit(store.checkout, ['diff-tree', '--no-commit-id', '--name-only', '-r', commit]).split('\n').filter(Boolean);
  if (!files.length || files.some(p => !p.startsWith(store.config.dir + '/'))) throw Error('Restore only supports knowledge-only commits');
  const before = revisionSnapshot(store, `${commit}^`); const after = revisionSnapshot(store, commit);
  const draft = await prepareKnowledgeDelivery(store, 'edit', options);
  try {
    const current = knowledgeSnapshot(draft.proposal);
    const paths = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(p => before[p] !== after[p]);
    for (const p of paths) if (current[p] !== after[p]) throw Error(`Cannot revert over newer knowledge: ${p}`);
    for (const p of paths) {
      if (before[p] === undefined) fs.rmSync(draft.proposal.resolve(p), { force: true });
      else atomicWrite(draft.proposal.resolve(p), before[p]);
    }
    return await finishKnowledgeDelivery(store, draft, options);
  } catch (e) { if (draft.record.state === 'preparing') failKnowledgeDelivery(store, draft, e); throw e; }
}
/** Apply only merged proposals, with one preflight for the whole proposal (moves included). */
const syncing = new Map<string, Promise<{ message: string }>>();
export function syncKnowledge(store: KnowledgeStore, options: DeliveryOptions = {}) {
  const key = fs.realpathSync(store.root);
  const active = syncing.get(key); if (active) return active;
  const run = applyMergedKnowledge(store, options).finally(() => { syncing.delete(key); });
  syncing.set(key, run); return run;
}
async function applyMergedKnowledge(store: KnowledgeStore, options: DeliveryOptions) {
  const records = deliveries(store); const messages: string[] = [];
  for (const record of records.filter(r => r.state === 'published')) {
    let state: 'published' | 'merged' | 'closed';
    if (options.reviewState) state = options.reviewState(record);
    else {
      const { cli, repo } = forge(store);
      const args = cli === 'gh' ? ['pr', 'view', record.url!, '--repo', repo, '--json', 'state'] : ['mr', 'view', record.url!, '--repo', repo, '--output', 'json'];
      const response = JSON.parse((await execAsync(cli, args, { cwd: store.checkout, timeout: 120000 })).stdout);
      const value = String(response.state).toLowerCase(); state = value === 'merged' ? 'merged' : value === 'closed' ? 'closed' : 'published';
    }
    if (state === 'published') { messages.push(`Awaiting review: ${record.url}`); continue; }
    if (state === 'closed') { record.state = state; save(store, record); messages.push('Knowledge review closed; live notes preserved.'); continue; }
    await remoteGit(store.checkout, ['fetch', 'origin', 'main']);
    const accepted = revisionSnapshot(store, 'origin/main');
    store.withLock(() => {
      const live = knowledgeSnapshot(store); const paths = record.paths ?? [];
      // A later edit to either the live tree or the PR requires explicit reconciliation.
      record.conflicts = paths.filter(p => accepted[p] !== record.after?.[p] || live[p] !== record.before[p] && live[p] !== accepted[p]);
      if (record.conflicts.length) { save(store, record); messages.push(`Merged review needs reconciliation: ${record.conflicts.join(', ')}`); return; }
      for (const p of paths) {
        if (accepted[p] === undefined) fs.rmSync(store.resolve(p), { force: true });
        else atomicWrite(store.resolve(p), accepted[p]);
      }
      const lint = lintKnowledge(store, true); if (lint.errors.length) throw Error(lint.errors.join('\n'));
      record.state = 'merged'; save(store, record); messages.push(`Applied merged knowledge review: ${record.url}`);
    });
  }
  return { message: messages.join('\n') || 'No published knowledge reviews to sync' };
}
