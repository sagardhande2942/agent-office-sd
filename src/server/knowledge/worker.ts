import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import type { Floor } from '../floor.js';
import type { WorkerFeature } from '../workers/features.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { CompletionReport } from '../../shared/completion.js';
import { DESK_BY_ID } from '../../shared/layout.js';
import { knowledgeBootstrapContext } from '../../shared/worker-knowledge.js';
import { KnowledgeStore, atomicWrite } from './store.js';
import { loadKnowledgeConfig } from './settings.js';
declare module '../../shared/completion.js' { interface CompletionReport { knowledgeReview?: string } }
const regular = (w: WorkerInfo) => w.kind === 'agent' && !w.helper && !w.meeting && !w.planReview?.locked && !DESK_BY_ID.get(w.deskId)?.station;
export function workerKnowledgeStore(floor: Pick<Floor, 'def'>, _worker: WorkerInfo) { return new KnowledgeStore(floor.def.dir, loadKnowledgeConfig(floor.def.dir)); }
export function knowledgeMrSection(store: KnowledgeStore, changed: string[], none?: string) {
  const notes = new Map(store.tree().map(n => [n.path, n]));
  return '## Knowledge base updates\n\n' + (changed.length ? changed.map(p => `- \`${p}\` — ${notes.get(p)?.frontmatter?.summary ?? 'Index updated.'}`).join('\n') : `No durable knowledge changed: ${none ?? 'Review found no updates.'}`) + '\n';
}
export function handoverText(worker: WorkerInfo, report?: CompletionReport) {
  return ['# Shift handover', 'Worker-reported evidence; verify before reuse.', `Task: ${report?.task ?? worker.task?.name ?? worker.prompt ?? worker.name}`,
    `Summary: ${report?.summary ?? 'Departed without a completion checklist.'}`, `Revision: ${worker.completionRevision ?? 0}`,
    ...(report?.checks.map(c => `${c.status.toUpperCase()}: ${c.name} — ${c.evidence}`) ?? []),
    `Files: ${report?.files.join(', ') || report?.filesNote || 'No files reported'}`, `PR: ${report?.pr ?? report?.prNote ?? 'No PR reported'}`,
    `Branch: ${report?.branch ?? worker.worktree?.branch ?? 'project checkout'}`, `Commit: ${report?.commit ?? 'not reported'}`].join('\n') + '\n';
}
export function writeHandover(store: KnowledgeStore, worker: WorkerInfo, report?: CompletionReport, extra = '') {
  const dir = path.resolve(store.checkout, store.config.handoversDir);
  if (!dir.startsWith(path.resolve(store.checkout) + path.sep)) throw Error('Handovers must remain inside the checkout');
  // Reuse the store's symlink validation for the independently configured journal root.
  new KnowledgeStore(store.checkout, { dir: store.config.handoversDir });
  const safeId = /^[a-zA-Z0-9_-]+$/.test(worker.id) ? worker.id : createHash('sha256').update(worker.id).digest('hex').slice(0, 24);
  const file = path.join(dir, `${safeId}-${worker.completionRevision ?? 0}.md`);
  const text = handoverText(worker, report) + extra;
  if (!fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== text) atomicWrite(file, text);
  return file;
}
export function reviewFollowup(worker: WorkerInfo, store: KnowledgeStore, report: CompletionReport) {
  return `Review git diff ${worker.worktree?.base ?? 'origin/main'}...HEAD and the task. Decide what durable knowledge changed: build/run/test steps, modules, gotchas, decisions or conventions. Update notes and indexes via knowledge tools, then call knowledge_review_done with changed paths or an explicit none_reason. ${store.config.commitMode === 'worker' ? `Commit separately as knowledge: ${worker.task?.name ?? 'task review'}.` : ''} Rebase before pushing; run agent-office knowledge lint --fix if an index conflicted. ${store.config.mrSection && report.pr ? `Push your branch and append/replace ## Knowledge base updates in ${report.pr}, listing paths with summaries. Detect the forge from git origin; use gh for GitHub or glab for GitLab. If the CLI is unavailable leave the section in the handover for a human.` : ''} Submit the completion checklist again after review.`;
}
export function knowledgeReviewGate(store: KnowledgeStore, worker: WorkerInfo, report: CompletionReport): string | undefined {
  store.seed(); const key = `${worker.id}:${worker.completionRevision ?? 0}`;
  let review: { changed: string[]; none_reason?: string } | undefined; let prompted = false;
  store.stateUpdate('reviews.json', data => { review = data[key] as typeof review; });
  store.stateUpdate('review-prompts.json', data => { prompted = !!data[key]; if (!review && store.config.reviewPolicy !== 'off') data[key] = true; });
  if (!review && store.config.reviewPolicy !== 'off' && !prompted) {
    writeHandover(store, worker, report, '\nKnowledge review pending.\n');
    if (store.config.reviewPolicy === 'required') return reviewFollowup(worker, store, report);
    report.knowledgeReview = reviewFollowup(worker, store, report);
  }
  if (review && store.config.commitMode === 'office' && review.changed.length) {
    const git = (args: string[]) => execFileSync('git', args, { cwd: store.checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    // Never include someone else's already-staged files in the office-owned commit.
    if (git(['diff', '--cached', '--name-only']).trim()) throw Error('Office knowledge commit needs a clean staging area');
    git(['add', '--', store.config.dir]);
    if (git(['diff', '--cached', '--name-only']).trim()) git(['commit', '-m', `knowledge: ${worker.task?.name ?? 'task review'}`]);
  }
  writeHandover(store, worker, report, review ? '\n' + knowledgeMrSection(store, review.changed, review.none_reason) : store.config.reviewPolicy === 'off' ? '' : '\nKnowledge review missing.\n' + (report.knowledgeReview ? '\nAdvisory knowledge review:\n' + report.knowledgeReview : ''));
}
export function workerKnowledge(floor: Floor): WorkerFeature {
  return {
    prompt(worker, text) {
      if (!regular(worker)) return text;
      const store = workerKnowledgeStore(floor, worker); store.seed();
      return (text ?? '') + knowledgeBootstrapContext(text ?? worker.prompt ?? '', { rootIndex: store.index(), notes: store.tree(), usage: store.usage(), handoversDir: store.config.handoversDir, budget: store.config.bootstrapBudgetChars, hintCount: store.config.hintCount, commitMode: store.config.commitMode, mrSection: store.config.mrSection });
    },
    completion(worker, report) { if (regular(worker)) return knowledgeReviewGate(workerKnowledgeStore(floor, worker), worker, report); },
    remove(worker) { if (regular(worker) && !worker.completion) writeHandover(workerKnowledgeStore(floor, worker), worker); },
  };
}
