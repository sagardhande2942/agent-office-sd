import type { CompletionReport, CompletionCheck } from '../shared/completion.js';

function text(value: unknown, name: string, max: number, optional = false): string | undefined {
  if (optional && value === undefined) return;
  if (typeof value !== 'string' || !value.trim() || value.length > max || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value)) throw new Error(`${name} must be nonempty text (up to ${max} characters)`);
  return value.trim();
}
/** Evidence is reported data. Never run commands or open files/URLs supplied here. */
export function readCompletion(body: unknown, revision: number, now = Date.now()): CompletionReport {
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Send a completion checklist object');
  const b = body as Record<string, unknown>;
  if (!Number.isSafeInteger(b.revision) || (b.revision as number) < 0 || b.revision !== revision) throw new Error('Task changed: read your checklist revision again before submitting');
  const summary = text(b.summary, 'summary', 2000)!;
  if (!Array.isArray(b.checks) || !b.checks.length || b.checks.length > 30) throw new Error('Provide 1–30 checks, with evidence or a reason for skipping');
  const checks: CompletionCheck[] = b.checks.map((item) => {
    if (!item || typeof item !== 'object' || !['passed', 'failed', 'skipped'].includes(item.status)) throw new Error('Check status must be passed, failed or skipped');
    return { name: text(item.name, 'check name', 240)!, status: item.status, evidence: text(item.evidence, 'check evidence / skip reason', 2000)! };
  });
  if (new Set(checks.map((c) => c.name.toLowerCase())).size !== checks.length) throw new Error('Check names must be unique');
  if (!Array.isArray(b.files) || b.files.length > 100) throw new Error('files must be an array of up to 100 paths');
  const files = [...new Set(b.files.map((f) => text(f, 'file path', 500)!))];
  const filesNote = text(b.filesNote, 'filesNote', 1000, true);
  if (!files.length && !filesNote) throw new Error('List changed files or explain why no files changed in filesNote');
  const pr = text(b.pr, 'pr', 1000, true), prNote = text(b.prNote, 'prNote', 1000, true);
  if (!pr && !prNote) throw new Error('Provide a PR URL or explain why there is no PR in prNote');
  if (pr) { let url: URL; try { url = new URL(pr); } catch { throw new Error('pr must be an HTTPS URL'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('pr must be an HTTPS URL without credentials'); }
  const commit = text(b.commit, 'commit', 40, true);
  if (commit && !/^[a-f0-9]{7,40}$/i.test(commit)) throw new Error('commit must be a 7–40 character hexadecimal hash');
  return { revision, summary, checks, files, ...(filesNote ? {filesNote} : {}), ...(pr ? {pr} : {}), ...(prNote ? {prNote} : {}), ...(commit ? {commit} : {}), submittedAt: now,
    status: checks.some((c) => c.status === 'failed') ? 'needs-attention' : 'ready' };
}
export function restoreCompletion(value: unknown, revision: number): CompletionReport | undefined {
  try {
    const stored = value as CompletionReport;
    if (!stored || !Number.isFinite(stored.submittedAt)) return;
    return { ...readCompletion(stored, revision, stored.submittedAt), ...(typeof stored.branch === 'string' ? {branch:stored.branch.slice(0,240)} : {}), ...(typeof stored.task === 'string' ? {task:stored.task.slice(0,2000)} : {}) };
  } catch { return; }
}
