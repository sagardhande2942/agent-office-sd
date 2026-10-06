// Session-only smartphone history. Messages use the existing worker.prompt request.

/** One line in an SMS thread: what you sent, or a note the phone adds itself (never the worker's words). */
export interface SmsMsg {
  dir: 'out' | 'note';
  text: string;
  /** When it was sent, on Date.now()'s clock. */
  at: number;
}

/** One line in Recents: a call you placed or an SMS you sent. */
export interface RecentEntry {
  kind: 'call' | 'sms';
  workerId: string;
  name: string;
  at: number;
}

/** How many messages a thread keeps, and how many lines Recents keeps. */
export const MAX_THREAD = 50;
export const MAX_RECENTS = 20;
/** How many threads are kept, in memory: the quietest go first. */
export const MAX_KEYS = 20;
/** The longest SMS kept or sent: the server truncates `worker.prompt` past this (`ws/handlers/workers.ts`). */
export const MAX_SMS_TEXT = 20000;

/** Threads by `floor/worker`, so each floor keeps its own conversations. */
export function threadKey(floor: string | null, workerId: string): string {
  return `${floor ?? 'lobby'}/${workerId}`;
}

/** A thread with `text` appended (a line the phone adds itself is a `note`). */
export function appendSms(thread: SmsMsg[] | undefined, text: string, dir: SmsMsg['dir'] = 'out'): SmsMsg[] {
  return [...(thread ?? []), { dir, text, at: Date.now() }].slice(-MAX_THREAD);
}

/** Recents with `entry` on top, one line per worker and kind at most. */
export function logRecent(recents: RecentEntry[], entry: RecentEntry): RecentEntry[] {
  return [entry, ...recents.filter((r) => r.workerId !== entry.workerId || r.kind !== entry.kind)].slice(0, MAX_RECENTS);
}

/** Never a thread key that would mutate a prototype when it becomes an object key. */
function isKeySafe(key: string): boolean {
  return key !== '__proto__' && key !== 'constructor' && key !== 'prototype';
}

/** The newest line's time, for evicting the quietest threads first (computed once per key). */
function latest(thread: SmsMsg[]): number {
  let m = 0;
  for (const x of thread) if (x.at > m) m = x.at;
  return m;
}

/** The in-memory map kept to the same cap (callers keep the returned map): the quietest go first. */
export function pruneThreadKeys(threads: Record<string, SmsMsg[]>): Record<string, SmsMsg[]> {
  const all = Object.keys(threads);
  const keys = all.filter((k) => isKeySafe(k) && threads[k].length > 0);
  if (keys.length === all.length && keys.length <= MAX_KEYS) return threads;
  const byLatest = new Map(keys.map((k) => [k, latest(threads[k])] as const));
  return Object.fromEntries(keys.sort((a, b) => (byLatest.get(b) ?? 0) - (byLatest.get(a) ?? 0)).slice(0, MAX_KEYS).map((k) => [k, threads[k]]));
}
