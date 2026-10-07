import type { ClientMsg, ServerMsg } from '../shared/protocol';
import { lastFloor, store, type Profile, type Spot } from './state';

const handoff = new URLSearchParams(location.search).get('floor');

type Handler = (msg: ServerMsg) => void;

/** The sign-in page, coming back to the 2D view afterwards if that's where you are (see login.ts). */
export function loginUrl(): string {
  return ['/lite', '/2d', '/game2d.html', '/2d.html'].includes(location.pathname) ? `/login?next=${location.pathname === '/lite' ? '/lite' : '/2d'}` : '/login';
}

export class Net {
  private ws: WebSocket | null = null;
  private handlers: Handler[] = [];
  private statusHandlers: ((up: boolean) => void)[] = [];
  private retry = 0;
  private closedByUs = false;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  /** The server is restarting on purpose: retry every second instead of backing off. */
  private restartExpected = false;
  up = false;

  constructor(
    private profile: () => Profile,
    /** Where you are (or were, before this page), to be put back in the same spot. */
    private where: () => Spot | null,
    /** On the 2D view: in the office without standing anywhere in it (see PeerInfo.lite). */
    private lite = false,
  ) {}

  onMessage(h: Handler) {
    this.handlers.push(h);
  }

  onStatus(h: (up: boolean) => void) {
    this.statusHandlers.push(h);
  }

  connect() {
    if (this.closedByUs || this.ws && this.ws.readyState < WebSocket.CLOSING) return;
    const { name, color, look } = this.profile();
    const proto = location.protocol === 'https:' ? 'wss' : 'ws';
    const q = new URLSearchParams({ name, color, skin: String(look.skin), hair: String(look.hair), style: String(look.style) });
    // Back to the floor you were on (after a reload or a restart), in the spot you were in there.
    const floor = store.floor ?? (handoff && (handoff === '@roof' || /^[a-zA-Z0-9_-]{1,128}$/.test(handoff)) ? handoff : lastFloor());
    if (floor) q.set('floor', floor);
    if (this.lite) q.set('lite', '1');
    const at = this.where();
    if (floor && at?.floor === floor) {
      for (const k of ['x', 'y', 'z'] as const) q.set(k, at[k].toFixed(2));
      q.set('rotY', at.facing.toFixed(3));
    }
    const ws = new WebSocket(`${proto}://${location.host}/ws?${q}`);
    this.ws = ws;
    ws.onopen = () => {
      if (this.closedByUs || this.ws !== ws) return;
      this.retry = 0;
      this.up = true;
      this.statusHandlers.forEach((h) => h(true));
    };
    ws.onmessage = (ev) => {
      if (this.closedByUs || this.ws !== ws) return;
      let msg: ServerMsg;
      try {
        msg = JSON.parse(ev.data);
      } catch {
        return;
      }
      for (const h of this.handlers) h(msg);
    };
    ws.onclose = async () => {
      if (this.ws !== ws) return;
      this.up = false;
      this.statusHandlers.forEach((h) => h(false));
      if (this.closedByUs) return;
      // Session expired? Go back to the door.
      try {
        const res = await fetch('/api/whoami', { cache: 'no-store' });
        if (this.closedByUs || this.ws !== ws) return;
        if (res.status === 401) {
          location.href = loginUrl();
          return;
        }
      } catch {
        // offline; keep retrying
      }
      if (this.closedByUs || this.ws !== ws) return;
      const delay = this.restartExpected ? 1000 : Math.min(8000, 500 * 2 ** this.retry++);
      this.retryTimer = setTimeout(() => this.connect(), delay);
    };
  }

  /** Intentional page exit must never reconnect an old view. */
  disconnect() {
    this.closedByUs = true;
    clearTimeout(this.retryTimer);
    const ws = this.ws;
    this.ws = null;
    this.up = false;
    ws?.close();
    this.statusHandlers.forEach(h => h(false));
  }

  expectRestart() {
    this.restartExpected = true;
  }

  send(msg: ClientMsg) {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}
