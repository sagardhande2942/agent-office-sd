import type { Ctx } from '../office/context.js';
import type { Route } from '../http/router.js';
import { readBody, sameOrigin, send } from '../http/util.js';

export const SERVER_RACK_STOP_PATH = '/api/server-rack/stop';
export const SERVER_RACK_SCAN_PATH = '/api/server-rack/scan';

export function parseStopPort(body: unknown): number | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const port = (body as { port?: unknown }).port;
  return typeof port === 'number' && Number.isInteger(port) && port >= 1 && port <= 65535 ? port : undefined;
}

export async function stopTrackedService(
  ctx: Pick<Ctx, 'services'>,
  port: number,
  kill: (pid: number, signal: NodeJS.Signals) => void = (pid, sig) => process.kill(pid, sig),
): Promise<{ ok: true; port: number; pid: number } | { ok: false; status: number; error: string }> {
  const svc = ctx.services.list().find((s) => s.port === port);
  if (!svc) return { ok: false, status: 404, error: `No active worker server on :${port}.` };
  try {
    kill(svc.pid, 'SIGTERM');
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code !== 'ESRCH') {
      return { ok: false, status: 502, error: `Could not stop :${port} (PID ${svc.pid}).` };
    }
  }
  await ctx.services.scan();
  return { ok: true, port: svc.port, pid: svc.pid };
}

export async function scanTrackedServices(
  ctx: Pick<Ctx, 'services'>,
): Promise<{ ok: true; count: number }> {
  await ctx.services.scan();
  return { ok: true, count: ctx.services.list().length };
}

export const serverRackRoutes = {
  stop: {
    auth: 'session',
    method: 'POST',
    path: SERVER_RACK_STOP_PATH,
    async handle(ctx, { req, res }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Open this from the office page.' });
      let port: number | undefined;
      try {
        port = parseStopPort(JSON.parse(await readBody(req, 16_384)));
      } catch {
        // invalid JSON
      }
      if (!port) return send(res, 400, { error: 'Provide a valid TCP port to stop.' });
      const result = await stopTrackedService(ctx, port);
      if (!result.ok) return send(res, result.status, { error: result.error });
      return send(res, 200, result);
    },
  },
  scan: {
    auth: 'session',
    method: 'POST',
    path: SERVER_RACK_SCAN_PATH,
    async handle(ctx, { req, res }) {
      if (!sameOrigin(req, ctx.cfg)) return send(res, 403, { error: 'Open this from the office page.' });
      const result = await scanTrackedServices(ctx);
      return send(res, 200, result);
    },
  },
} satisfies Record<string, Route>;
