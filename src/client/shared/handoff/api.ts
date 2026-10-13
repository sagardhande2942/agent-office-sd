import type { HandoffPacket } from '../../../shared/handoff';

// Reading the handoff station: the office serves a floor's packets at GET /api/handoffs?floor=<id>.
// Nothing here creates, accepts or cancels one — those are a worker's own authenticated actions (see
// docs/agent-handoff.md) — so the browser can only ever look at what the workers did.

/** Where the office serves a floor's handoff packets. */
export const HANDOFFS_PATH = '/api/handoffs';

/** The station's `{ handoffs }` body: the packets a floor is holding. */
export interface HandoffsResponse {
  handoffs: HandoffPacket[];
}

/** What this module needs of a response, so the tests can stand in for fetch. */
export interface HandoffResponse {
  ok: boolean;
  status: number;
  json(): Promise<unknown>;
}

export type HandoffRequester = (url: string) => Promise<HandoffResponse>;

const browserRequest: HandoffRequester = (url) => fetch(url, { credentials: 'same-origin', cache: 'no-store' });

/**
 * The packets the station served, refusing anything that isn't `{ handoffs: [...] }`: a sign-in page
 * or a half-applied update then reads as an error rather than as a floor with no handoffs at all.
 */
export function parseHandoffs(body: unknown): HandoffPacket[] {
  const handoffs = (body as HandoffsResponse | null | undefined)?.handoffs;
  if (!Array.isArray(handoffs)) throw new Error('The handoff station returned an unexpected response.');
  return handoffs;
}

/** The server's own message when it sends one, and what went wrong when it doesn't. */
export async function handoffError(response: HandoffResponse): Promise<string> {
  try {
    const body = (await response.json()) as { error?: unknown } | null;
    if (body && typeof body === 'object' && typeof body.error === 'string' && body.error) return body.error;
  } catch {
    // A body that isn't JSON says no more than the status does.
  }
  return `The handoff station could not be read (HTTP ${response.status}).`;
}

/** A floor's handoff packets, as the office holds them now. */
export async function fetchHandoffs(floorId: string, request: HandoffRequester = browserRequest): Promise<HandoffPacket[]> {
  const response = await request(`${HANDOFFS_PATH}?floor=${encodeURIComponent(floorId)}`);
  if (!response.ok) throw new Error(await handoffError(response));
  return parseHandoffs(await response.json());
}
