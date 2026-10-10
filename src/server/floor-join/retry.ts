export const RETRY_WINDOW_MS = 10 * 60 * 1000;
export interface AttemptResult { code: number; retry: boolean; }

/** Reset the outage window only after authenticated welcome, not merely a TCP/WebSocket open. */
export async function retryConnection(
  attempt: (authenticated: () => void) => Promise<AttemptResult>,
  signal: AbortSignal,
  options: { now?: () => number; wait?: (ms: number, signal: AbortSignal) => Promise<void>; log?: (ms: number, remaining: number) => void; expired?: () => void } = {},
): Promise<number> {
  const now = options.now ?? Date.now;
  const wait = options.wait ?? delay;
  let deadline: number | undefined;
  let failures = 0;
  while (!signal.aborted) {
    const result = await attempt(() => { deadline = undefined; failures = 0; });
    if (signal.aborted) return 0;
    if (!result.retry) return result.code;
    deadline ??= now() + RETRY_WINDOW_MS;
    const remaining = deadline - now();
    if (remaining <= 0) { options.expired?.(); return 1; }
    const ms = Math.min(1000 * 2 ** Math.min(failures++, 4), 15_000, remaining);
    options.log?.(ms, remaining);
    await wait(ms, signal);
  }
  return 0;
}

function delay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise(resolve => {
    const finish = () => { clearTimeout(timer); signal.removeEventListener('abort', finish); resolve(); };
    const timer = setTimeout(finish, ms);
    signal.addEventListener('abort', finish, { once: true });
    if (signal.aborted) finish();
  });
}
