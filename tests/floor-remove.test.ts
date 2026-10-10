import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Building } from '../src/server/building.js';
import { floorHelpers } from '../src/server/office/floors.js';
import type { Ctx } from '../src/server/office/context.js';
import type { Client } from '../src/server/office/client.js';
import { floorHandlers } from '../src/server/ws/handlers/floors.js';

for (const orphan of [false, true]) test(`Delete clears an offline remote floor${orphan ? ' left behind by an earlier deletion' : ' and its saved definition'}`, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-remove-'));
  const def = { id: 'remote', name: 'Mock server', dir: '/joiner/project', host: 'laptop', palette: 0, addedBy: 'test', addedAt: 0 };
  writeFileSync(path.join(dir, 'floors.json'), JSON.stringify(orphan ? [] : [def]));
  const broadcasts: unknown[] = [], warnings: string[] = [];
  let gone = 0, lobby = 0;
  const client = { peer: { name: 'Admin', floor: def.id }, accountId: 'admin' } as Client;
  const remote = { id: def.id, def, info: () => ({ ...def, host: { reachable: false } }), onGone: () => gone++ };
  const ctx = {
    building: new Building(dir, dir), floors: new Map(), remoteFloors: new Map([[def.id, remote]]),
    clients: new Map([['admin', client]]), meOf: () => ({ admin: true }),
    broadcast: (m: unknown) => broadcasts.push(m), warn: (_c: Client, text: string) => warnings.push(text),
    sendTo: () => {}, toLobby: () => lobby++, pumpQueues: () => {},
  } as unknown as Ctx;
  Object.assign(ctx, floorHelpers(ctx));
  try {
    await floorHandlers['floor.remove'](ctx, client, { t: 'floor.remove', floor: def.id });
    assert.equal(ctx.remoteFloors.size, 0);
    assert.deepEqual(JSON.parse(readFileSync(path.join(dir, 'floors.json'), 'utf8')), []);
    assert.deepEqual(broadcasts[0], { t: 'floors', floors: [] });
    assert.deepEqual(warnings, []);
    assert.equal(gone, 1);
    assert.equal(lobby, 1);
    await floorHandlers['floor.remove'](ctx, client, { t: 'floor.remove', floor: def.id });
    assert.deepEqual(warnings, ['No such floor']);
  } finally {
    ctx.cancelFloorsChanged();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('a non-admin cannot remove even an orphaned remote floor', async () => {
  let touched = false;
  const warnings: string[] = [];
  const ctx = { meOf: () => ({ admin: false }), warn: (_c: Client, text: string) => warnings.push(text), building: { remove: () => { touched = true; } } } as unknown as Ctx;
  await floorHandlers['floor.remove'](ctx, { peer: { name: 'Guest' } } as Client, { t: 'floor.remove', floor: 'remote' });
  assert.equal(touched, false);
  assert.deepEqual(warnings, ['Only admins can take a floor off the building']);
});
