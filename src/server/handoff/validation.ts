import type { CompletionCheck } from '../../shared/completion.js';
import type { HandoffContext } from '../../shared/handoff.js';
export function text(value: unknown, label: string, max = 8000): string {
  if (typeof value !== 'string' || !value.trim() || value.length > max || value.includes('\0')) throw Error(`${label} requires nonempty text, at most ${max} characters`);
  return value.trim();
}
export function optional(value: unknown, label: string, max = 8000): string | undefined { return value === undefined ? undefined : text(value, label, max); }
export function strings(value: unknown, label: string, max: number, length: number): string[] {
  if (!Array.isArray(value) || value.length > max) throw Error(`${label} must be an array of at most ${max} entries`);
  return value.map(v => text(v, label, length));
}
export function checks(value: unknown): CompletionCheck[] {
  if (!Array.isArray(value) || !value.length || value.length > 30) throw Error('checks requires 1-30 checks (use skipped with a reason when no checks ran)');
  return value.map(v => {
    if (!v || typeof v !== 'object' || !['passed', 'failed', 'skipped'].includes(v.status)) throw Error('Invalid check status');
    return { name: text(v.name, 'check name', 200), status: v.status, evidence: text(v.evidence, 'check evidence', 4000) };
  });
}
export function context(value: unknown): HandoffContext {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('context must be an object');
  const c = value as Record<string, unknown>;
  if (Object.keys(c).some(k => !['branch', 'commit', 'pr', 'worktree'].includes(k))) throw Error('Unknown context field');
  const branch = optional(c.branch, 'branch', 240), commit = optional(c.commit, 'commit', 40), pr = optional(c.pr, 'pr', 1000), worktree = optional(c.worktree, 'worktree', 1000);
  if (commit && !/^[a-f\d]{7,40}$/i.test(commit)) throw Error('commit must be a git hash');
  if (pr && !/^https?:\/\//.test(pr)) throw Error('pr must be an HTTP URL');
  return { ...(branch ? { branch } : {}), ...(commit ? { commit } : {}), ...(pr ? { pr } : {}), ...(worktree ? { worktree } : {}) };
}
