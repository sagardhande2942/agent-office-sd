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

/** One worker's overlaps: the others it names, and how many more there are than it names. */
export interface WorkerOverlapGroup {
  /** At most OVERLAP_WORKERS_MAX of the workers that overlap, in the order they were found. */
  others: WorkerOverlap[];
  /** How many more overlap than are named, so a cut-short list says so instead of reading as all. */
  moreWorkers: number;
}

/** How many other workers one worker's overlap list names, and how many files of each. */
export const OVERLAP_WORKERS_MAX = 5;
export const OVERLAP_FILES_MAX = 10;

/**
 * Which workers with open pull requests touch the same files, per worker: every other worker sharing
 * a path with it, and the paths they share. Reads only the changed-file lists workers submit with
 * their checklists, so a worker that hasn't submitted one contributes no signal at all. Exact paths
 * only. Both lists are capped, and a group carries how many more workers it isn't naming, rather than
 * dropping the rest quietly.
 *
 * Only workers with an open pull request belong here, so the caller resolves each worker's current
 * pull request first (see workerPr) — a worker keeps its link and its checklist after the pull
 * request merges, and naming a merged one as an open one is worse than naming none.
 */
export function workerFileCollisions(workers: CollisionWorker[]): Map<string, WorkerOverlapGroup> {
  const onBoard = workers.filter((w) => w.pr !== undefined && (w.files?.length ?? 0) > 0);
  const out = new Map<string, WorkerOverlapGroup>();
  for (const w of onBoard) {
    const others: WorkerOverlap[] = [];
    let overlapping = 0;
    for (const b of onBoard) {
      if (b.id === w.id) continue;
      const files = sharedFiles(w.files!, b.files!);
      if (!files.length) continue;
      overlapping++;
      // Keep counting past the cap, so `moreWorkers` is how many are really there and not how many fit.
      if (others.length >= OVERLAP_WORKERS_MAX) continue;
      others.push({ worker: { id: b.id, name: b.name }, ...(b.pr !== undefined ? { pr: b.pr } : {}), files: files.slice(0, OVERLAP_FILES_MAX), ...(files.length > OVERLAP_FILES_MAX ? { capped: true } : {}) });
    }
    if (overlapping) out.set(w.id, { others, moreWorkers: overlapping - others.length });
  }
  return out;
}

/**
 * What one of these reads as a sentence, for a blocker's why and the merge prompt's `{{others}}`:
 * who else is landing on these files and which ones, and how many more there are than are named.
 * Empty when there is nothing, so a caller can pass it straight in and the prompt drops the line.
 */
export function overlapLines(group: WorkerOverlapGroup | undefined): string {
  if (!group?.others.length) return '';
  const named = group.others.map((o) => `${o.pr !== undefined ? `PR #${o.pr} from ${o.worker.name}` : `${o.worker.name}'s pull request`} (${o.files.join(', ')}${o.capped ? ', and more' : ''})`).join('; ');
  return `Other open pull requests changing the same files: ${named}${group.moreWorkers ? `; and ${group.moreWorkers} more` : ''}.`;
}