export interface QueueTask {
  id: string; candidate_id: string; department: string; pattern: string; version: number;
  input: Record<string, unknown>; claim_token?: string; execution_key?: string;
}
export class BridgeError extends Error { constructor(readonly status: number, message: string) { super(message); } }
export interface Bridge { call<T>(operation: string, body?: unknown): Promise<T> }
export class ResearchBridge implements Bridge {
  constructor(private endpoint: string, private floor: string, private token: string) {
    const url = new URL(endpoint);
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.pathname !== '/research/v1/' || url.username || url.password || url.search || url.hash)
      throw Error('Research bridge must be http://127.0.0.1:PORT/research/v1/');
    if (token.length < 32) throw Error('Research bridge credential is missing or too short');
  }
  async call<T>(operation: string, body?: unknown): Promise<T> {
    if (!/^[a-z-]+$/.test(operation)) throw Error('Invalid bridge operation');
    const response = await fetch(this.endpoint + operation, { method: body === undefined ? 'GET' : 'POST',
      headers: { authorization: 'Bearer ' + this.token, 'X-Research-Floor': this.floor, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(30000), redirect: 'error' });
    const raw = await response.text(); if (raw.length > 2 * 1024 * 1024) throw Error('Oversized research bridge response');
    const result = JSON.parse(raw);
    if (!response.ok) throw new BridgeError(response.status, `Research bridge ${response.status}: ${String(result.error ?? 'operation refused').slice(0, 500)}`);
    return result as T;
  }
}
