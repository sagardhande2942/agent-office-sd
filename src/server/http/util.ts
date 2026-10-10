import type http from 'node:http';
import type { Config } from '../config.js';

export function clientIp(req: http.IncomingMessage, trustProxy: boolean): string {
  if (trustProxy) {
    const fwd = req.headers['x-forwarded-for'];
    // The rightmost hop is the one our proxy appended; anything left of it is client-controlled.
    if (typeof fwd === 'string' && fwd) return fwd.split(',').pop()!.trim();
  }
  return req.socket.remoteAddress ?? '?';
}

export function isSecure(req: http.IncomingMessage, cfg: Config): boolean {
  if (cfg.tls) return true;
  return cfg.trustProxy && req.headers['x-forwarded-proto'] === 'https';
}

export function readBody(req: http.IncomingMessage, limit = 1024 * 1024): Promise<string> {
  return readBytes(req, limit).then((b) => b.toString('utf8'));
}

/**
 * The request's body, at most `limit` bytes; a string saying `too large` when it is over.
 *
 * Over the limit the rest of the body is drained rather than the socket destroyed, because the caller
 * still has an answer to send — a 413 saying so, which is what every caller does with `too large`. A
 * destroyed socket takes that answer with it and the client sees a connection error instead, which says
 * nothing about what was wrong with it.
 */
export function readBytes(req: http.IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    let over = false;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        if (!over) {
          over = true;
          chunks.length = 0;
          reject(new Error('too large'));
        }
        return; // drained, and thrown away: what is left of the body is nobody's business
      }
      chunks.push(c);
    });
    req.on('end', () => (over ? undefined : resolve(Buffer.concat(chunks))));
    req.on('error', reject);
  });
}

/** Whether the page asking is the office itself, so another site can't open a socket with a visitor's cookie. */
export function sameOrigin(req: http.IncomingMessage, cfg: Config): boolean {
  const origin = req.headers.origin;
  const host = (cfg.trustProxy && (req.headers['x-forwarded-host'] as string)) || req.headers.host;
  try {
    return !!origin && new URL(origin).host === host;
  } catch {
    return false;
  }
}

export function send(res: http.ServerResponse, status: number, body: unknown, headers: Record<string, string> = {}) {
  const json = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers });
  res.end(json);
}
