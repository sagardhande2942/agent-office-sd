import test from 'node:test';
import assert from 'node:assert/strict';

// The real Net in a browser-like transport, including asynchronous close/session checks.
const sockets: FakeSocket[] = [];
class FakeSocket {
  static OPEN = 1; static CLOSING = 2;
  readyState = 0;
  onopen?: () => void; onclose?: () => Promise<void>; onmessage?: (event: { data: string }) => void;
  closed = false;
  constructor(public url: string) { sockets.push(this); }
  close() { this.closed = true; this.readyState = 3; }
  send() {}
}
Object.assign(globalThis, { location: { pathname: '/2d', search: '?floor=floor-two', protocol: 'http:', host: 'office.test' }, WebSocket: FakeSocket });
const { Net, loginUrl } = await import('../src/client/net');
const profile = () => ({ name: 'Test', color: '#abc', look: { skin: 0, hair: 0, style: 0 } });
test('floor handoff is used, positioned 2D connects once, disconnect rejects stale callbacks', () => {
  const net = new Net(profile, () => null);
  net.connect(); net.connect();
  assert.equal(sockets.length, 1); assert.ok(sockets[0].url.includes('floor=floor-two')); assert.ok(!sockets[0].url.includes('lite=1'));
  net.disconnect(); sockets[0].onopen?.(); net.connect();
  assert.equal(net.up, false); assert.equal(sockets.length, 1); assert.ok(sockets[0].closed);
  assert.equal(loginUrl(), '/login?next=/2d');
});
test('intentional exit during a session check cannot schedule reconnection', async () => {
  const net = new Net(profile, () => null);
  net.connect(); const ws = sockets.at(-1)!;
  let finish!: (value: { status: number }) => void;
  const original = globalThis.fetch;
  globalThis.fetch = (() => new Promise(resolve => { finish = resolve; })) as typeof fetch;
  try {
    const close = ws.onclose!(); net.disconnect(); finish({ status: 401 }); await close;
    assert.equal((net as any).retryTimer, undefined);
    assert.equal('href' in location, false);
    assert.equal(net.up, false);
  } finally { globalThis.fetch = original; }
});
