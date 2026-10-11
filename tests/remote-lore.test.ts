import test from 'node:test';
import assert from 'node:assert/strict';
import { RemoteFloor } from '../src/server/remote-floor.js';
import { LoreStore } from '../src/server/lore.js';
import { loreHostCalls } from '../src/server/lore/host.js';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Floor } from '../src/server/floor.js';
import type { HostRegistry } from '../src/server/floor-hosts.js';
import type { LoreNote } from '../src/shared/protocol/lore.js';

const note: LoreNote = { id: 'knowledge-1', title: 'Host fact', content: 'Observed on the host', author: 'Ada', tags: ['auth'], createdAt: 1, updatedAt: 1 };
test('host memory snapshots, updates and RPCs share one remote mirror and reset on reconnect', async () => {
  const sent: any[] = [];
  const socket = { send: (msg: any) => sent.push(msg) };
  const registry = { serves: () => socket, isReachable: () => true, nameOf: () => 'Host' } as unknown as HostRegistry;
  const floor = new RemoteFloor('f1', 'Host', 'h1', registry, { id: 'f1', name: 'API', dir: '/host-only', palette: 0, addedBy: 'test', addedAt: 1 });
  const ready = { t: 'ready' as const, floor: { floorId: 'f1', name: 'API', seats: 1, accepting: false, workers: [], forge: 'github' as const, lore: true } };
  floor.deliver(ready);
  floor.deliver({ t: 'event', floorId: 'f1', seq: 0, msg: { t: 'lore.all', notes: [note] } });
  assert.deepEqual(floor.lore.list(), [note]);
  const updated = { ...note, content: 'Corrected', updatedAt: 2 };
  floor.deliver({ t: 'event', floorId: 'f1', seq: 0, msg: { t: 'lore.saved', note: updated } });
  assert.deepEqual(floor.lore.list(), [updated]);
  const save = floor.lore.save({ title: 'Host fact', content: 'New', author: 'Ada' });
  assert.equal(sent[0].t, 'lore.save');
  floor.deliver({ t: 'result', floorId: 'f1', seq: sent[0].seq, value: updated });
  assert.deepEqual(await save, updated);
  const deleted = floor.lore.delete(note.id);
  floor.deliver({ t: 'result', floorId: 'f1', seq: sent[1].seq, value: true });
  assert.equal(await deleted, true);
  floor.deliver({ t: 'event', floorId: 'f1', seq: 0, msg: { t: 'lore.deleted', id: note.id } });
  assert.deepEqual(floor.lore.list(), []);
  floor.deliver({ t: 'event', floorId: 'f1', seq: 0, msg: { t: 'lore.saved', note } });
  floor.deliver(ready); assert.deepEqual(floor.lore.list(), []);
  floor.deliver({ ...ready, floor: { ...ready.floor, lore: false } });
  await assert.rejects(floor.lore.delete(note.id), /Update the floor host/);
});

test('host lore calls write only the host store and retain path traversal rejection', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'lore-host-rpc-'));
  try {
    const lore = new LoreStore(dir), floor = { lore } as Floor;
    const saved = loreHostCalls['lore.save'](floor, { note: { title: 'Host fact', content: 'Verified', author: 'Ada' } }) as LoreNote;
    assert.deepEqual(loreHostCalls['lore.list'](floor, {}), [saved]);
    assert.throws(() => loreHostCalls['lore.save'](floor, { note: { id: '../workers', title: 'Unsafe', content: 'No', author: 'Ada' } }), /Invalid lore note ID/);
    assert.equal(loreHostCalls['lore.delete'](floor, { id: saved.id }), true);
    assert.deepEqual(new LoreStore(dir).list(), []);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
