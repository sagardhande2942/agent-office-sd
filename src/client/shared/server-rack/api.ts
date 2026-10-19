export const SERVER_RACK_STOP_PATH = '/api/server-rack/stop';
export const SERVER_RACK_SCAN_PATH = '/api/server-rack/scan';

export interface RackStopResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export async function stopServicePort(
  port: number,
  request: (url: string, init: RequestInit) => Promise<RackStopResponse> = (url, init) => fetch(url, init),
): Promise<{ ok: true; port: number; pid: number }> {
  const res = await request(SERVER_RACK_STOP_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ port }),
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (!body || typeof body !== 'object' || (body as { ok?: unknown }).ok !== true) {
    throw new Error('Server rack returned an unexpected response.');
  }
  const { port: stoppedPort, pid } = body as { port: number; pid: number };
  return { ok: true, port: stoppedPort, pid };
}

export async function scanServicePorts(
  request: (url: string, init: RequestInit) => Promise<RackStopResponse> = (url, init) => fetch(url, init),
): Promise<{ ok: true; count: number }> {
  const res = await request(SERVER_RACK_SCAN_PATH, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  });
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const msg = body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string'
      ? (body as { error: string }).error
      : `HTTP ${res.status}`;
    throw new Error(msg);
  }
  if (!body || typeof body !== 'object' || (body as { ok?: unknown }).ok !== true) {
    throw new Error('Server rack returned an unexpected response.');
  }
  const { count } = body as { count: number };
  return { ok: true, count };
}
