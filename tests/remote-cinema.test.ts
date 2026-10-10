import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteCinema } from '../src/server/cinema/remote.js';
import { Cinema } from '../src/server/cinema.js';
import { cinemaHostCalls } from '../src/server/cinema/host.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Floor } from '../src/server/floor.js';
const image = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
const state = () => ({ reels: [{ id: 'aaaaaaaaaaaa', title: 'Demo', at: 0, shots: [{ caption: 'One', width: 1, height: 1 }] }], on: true, reel: 'aaaaaaaaaaaa', frame: 0, playing: true, at: 10 });
test('remote screenshots coalesce requests, reject removed shots and clear across reconnect', async () => {
  let finish!: (r: unknown) => void, calls = 0, online = true;
  const remote = new RemoteCinema(async () => { calls++; return new Promise(r => finish = r); }, () => online, () => true);
  remote.receive({ state: state() });
  const a = remote.frame('aaaaaaaaaaaa', 0), b = remote.frame('aaaaaaaaaaaa', 0);
  assert.equal(calls, 1); finish({ image });
  assert.deepEqual(await a, await b); assert.ok(Buffer.isBuffer(await remote.frame('aaaaaaaaaaaa', 0)));
  assert.equal(calls, 1);
  online = false; assert.match(String(await remote.frame('aaaaaaaaaaaa', 0)), /offline/);
  online = true; remote.reset();
  const old = remote.frame('aaaaaaaaaaaa', 0); remote.reset(); finish({ image });
  assert.equal(await old, undefined, 'an answer from the old connection is discarded');
  remote.receive({ state: { ...state(), reels: [] } });
  assert.equal(await remote.frame('aaaaaaaaaaaa', 0), undefined);
});
test('host clock offset is removed and old hosts get an explicit update message', async () => {
  const remote = new RemoteCinema(async () => { throw new Error('must not call an old host'); }, () => true, () => false);
  const s = state(); remote.receive({ state: s, hostNow: 5010 });
  assert.ok(Math.abs(remote.state().at - (Date.now() - 5000)) < 100);
  assert.match((await remote.play('aaaaaaaaaaaa', 0) as { error: string }).error, /Update/);
});
test('remote image responses reject oversized and invalid PNGs', async () => {
  for (const image of ['bad', 'A'.repeat(900000)]) {
    const remote = new RemoteCinema(async () => ({ image }), () => true, () => true);
    remote.receive({ state: state() });
    assert.equal(typeof await remote.frame('aaaaaaaaaaaa', 0), 'string');
  }
});
test('host cinema calls operate on its own disk and refuse unknown indices and paths', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'remote-cinema-'));
  try {
    const cinema = new Cinema(dir), floor = { cinema } as Floor;
    const reel = cinema.add({ title: 'Demo', shots: [{ caption: 'One', width: 1, height: 1 }] }, [Buffer.from(image, 'base64')]);
    assert.deepEqual(cinemaHostCalls['cinema.shot'](floor, { reel: reel.id, n: 0 }), { image });
    for (const [id, n] of [['../file', 0], [reel.id, -1], [reel.id, 1], [reel.id, .5]]) assert.equal(cinemaHostCalls['cinema.shot'](floor, { reel: id, n }), null);
    cinemaHostCalls['cinema.pause'](floor, { frame: 0 }); assert.equal(cinema.state().playing, false);
    cinemaHostCalls['cinema.remove'](floor, { reel: reel.id });
    assert.equal(cinemaHostCalls['cinema.shot'](floor, { reel: reel.id, n: 0 }), null);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('screenshot cache and concurrent transfers have fixed limits', async () => {
  let calls = 0;
  const remote = new RemoteCinema(async () => { calls++; return { image }; }, () => true, () => true);
  const s = state(); s.reels[0].shots = Array.from({ length: 12 }, () => ({ caption: 'Step', width: 1, height: 1 }));
  remote.receive({ state: s });
  for (let n = 0; n < 5; n++) await remote.frame('aaaaaaaaaaaa', n);
  await remote.frame('aaaaaaaaaaaa', 0); assert.equal(calls, 6, 'only four images are retained');
  const finish: ((v: unknown) => void)[] = [];
  const busy = new RemoteCinema(async () => new Promise(r => finish.push(r)), () => true, () => true);
  busy.receive({ state: s });
  const pending = Array.from({ length: 8 }, (_, n) => busy.frame('aaaaaaaaaaaa', n));
  assert.match(String(await busy.frame('aaaaaaaaaaaa', 8)), /busy/);
  assert.equal(finish.length, 8); finish.forEach(r => r({ image })); await Promise.all(pending);
});
