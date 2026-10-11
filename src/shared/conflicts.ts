// Why two workers' pull requests will fight, worked out from what the office already holds: whether a
// pull request conflicts with its base (the forge's own answer), and which files two workers' open
// pull requests both touch. Pure and shared, so the server (which reports it) and the browser (which
// shows it) cannot disagree about what "conflicting" means.

/** The one rule: an open, ready pull request whose branch cannot merge into its base without a hand. */
export interface MergeState {
  state: string;
  isDraft: boolean;
  /** MERGEABLE, CONFLICTING or UNKNOWN (the forge still working it out). */
  mergeable?: string;
  /** CLEAN, BLOCKED, BEHIND, DIRTY, UNSTABLE, DRAFT, HAS_HOOKS or UNKNOWN. */
  mergeStateStatus?: string;
}

/**
 * Whether a pull request conflicts with its base and cannot merge until someone resolves it. A forge
 * that doesn't say (`UNKNOWN`, or no field at all, as on Bitbucket) is not a conflict: the office never
 * says "conflicting" on what it wasn't told.
 */
export function isConflicting(p: MergeState): boolean {
  return p.state === 'OPEN' && !p.isDraft && (p.mergeable === 'CONFLICTING' || p.mergeStateStatus === 'DIRTY');
}

/**
 * A path as two reports of it can be compared: no leading `./` or `/`, and no case difference (git
 * paths are compared exactly, but a worker typing `SRC/App.ts` meant the file it edited).
 */
export function normalizeFilePath(f: string): string {
  return f.trim().replace(/^\.\//, '').replace(/^\/+/, '').toLowerCase();
}

/** The paths two file lists have in common, as the office reads them; empty when they don't. */
export function sharedFiles(a: string[], b: string[]): string[] {
  const mine = new Set(a.map(normalizeFilePath).filter(Boolean));
  if (!mine.size) return [];
  return [...new Set(b.map(normalizeFilePath).filter((f) => mine.has(f)))].sort();
}

/** A worker as the collision report needs it: who it is, its pull request and the files it changed. */
export interface CollisionWorker {
  id: string;
  name: string;
  /** Its open pull request; a worker with none isn't on this board. */
  pr?: number;
  /** The files its checklist reported; no report means no signal, not an empty list. */
  files?: string[];
}

/** One other worker whose open pull request touches the same files as this one's. */
export interface WorkerOverlap {
  worker: { id: string; name: string };
  pr?: number;
  /** The paths both pull requests touch. */
  files: string[];
  /** True when there were more files than are named here. */
  capped?: boolean;
}

/** How many other workers one worker's overlap list names, and how many files of each. */
export const OVERLAP_WORKERS_MAX = 5;
export const OVERLAP_FILES_MAX = 10;

/**
 * Which workers with open pull requests touch the same files, per worker: every other worker sharing
 * a path with it, and the paths they share. Reads only the changed-file lists workers submit with
 * their checklists, so a worker that hasn't submitted one contributes no signal at all. Exact paths
 * only, and the output is capped and says so, rather than quietly dropping the rest.
 */
export function workerFileCollisions(workers: CollisionWorker[]): Map<string, WorkerOverlap[]> {
  const onBoard = workers.filter((w) => w.pr !== undefined && (w.files?.length ?? 0) > 0);
  const out = new Map<string, WorkerOverlap[]>();
  for (const w of onBoard) {
    const others: WorkerOverlap[] = [];
    for (const b of onBoard) {
      if (b.id === w.id) continue;
      const files = sharedFiles(w.files!, b.files!);
      if (!files.length) continue;
      others.push({ worker: { id: b.id, name: b.name }, ...(b.pr !== undefined ? { pr: b.pr } : {}), files: files.slice(0, OVERLAP_FILES_MAX), ...(files.length > OVERLAP_FILES_MAX ? { capped: true } : {}) });
      if (others.length === OVERLAP_WORKERS_MAX) break;
    }
    if (others.length) out.set(w.id, others);
  }
  return out;
}

/**
 * What one of these reads as a sentence, for a blocker's why and the merge prompt's `{{others}}`:
 * who else is landing on these files and which ones. Empty when there is nothing, so a caller can
 * pass it straight in and the prompt drops the line.
 */
export function overlapLines(overlaps: WorkerOverlap[]): string {
  if (!overlaps.length) return '';
  return `Other open pull requests changing the same files: ${overlaps
    .map((o) => `${o.pr !== undefined ? `PR #${o.pr} from ${o.worker.name}` : `${o.worker.name}'s pull request`} (${o.files.join(', ')}${o.capped ? ', and more' : ''})`)
    .join('; ')}.`;
}