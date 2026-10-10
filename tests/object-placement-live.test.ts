import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { PLACEMENT_DEFAULTS, validPlacement } from '../src/shared/object-placement';
import { Placements } from '../src/server/object-placement/storage';
import { placements, startPlacementClock } from '../src/server/object-placement/service';
import { placementHandlers, placementView, placementHooks } from '../src/server/ws/handlers/object-placement';
import { LivePlacements } from '../src/client/features/object-placement/live';
import type { PlacementClientMsg, PlacementServerMsg } from '../src/shared/protocol/object-placement';

const transform = { position: [5, 0, 3], rotation: [0, .375, 0], scale: [1.2, 1.2, 1.2] };
const id = 'lounge-coffee-table';
test('atomic shared layouts survive restarts, isolate floors, and import only missing objects', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'office-placement-'));
  const a = new Placements(path.join(dir, 'floor-a.json')), b = new Placements(path.join(dir, 'floor-b.json'));
  a.set(id, transform); a.set('plant-5', { ...transform, scale: [1, 1, 1] }); a.flush();
  assert.deepEqual(new Placements(path.join(dir, 'floor-a.json')).get(id), transform);
  assert.equal(b.get(id), undefined);
  assert.equal(a.set(id, PLACEMENT_DEFAULTS[id], true), false);
  assert.deepEqual(a.get(id), transform); assert.equal(a.flush(), false);
  assert.equal(a.state()['plant-5'].scale[0], 1);
});
test('failed atomic writes keep dirty data for retry', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'office-placement-retry-')), file = path.join(dir, 'state.json');
  mkdirSync(file); const store = new Placements(file); store.set(id, transform);
  assert.throws(() => store.flush()); assert.equal(store.unsaved, true);
  rmdirSync(file); assert.equal(store.flush(), true);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).items[id], transform);
});
test('server only accepts opted-in objects and bounded uniform transforms', () => {
  assert.equal(validPlacement(id, transform), true);
  for (const name of ['desk-1', '__proto__', '../floor', 'plant-1']) assert.equal(validPlacement(name, transform), false);
  for (const t of [{ ...transform, scale: [1, 2, 1] }, { ...transform, scale: [4, 4, 4] },
    { ...transform, position: [100, 0, 0] }, { ...transform, position: [0, 10, 0] },
    { ...transform, rotation: [NaN, 0, 0] }]) assert.equal(validPlacement(id, t), false);
});
function fixture() {
  const floor = { id: 'f1' }, other = { id: 'f2' }, messages: any[] = [], warnings: string[] = [];
  const ctx: any = { cfg: { dataDir: mkdtempSync(path.join(os.tmpdir(), 'office-placement-handler-')) }, maps: { plan: () => ({ id: 'office' }) },
    floorOf: () => floor, anyFloor: (id: string) => id === 'f1' ? floor : other,
    toFloor: (f: any, msg: any) => messages.push({ floor: f.id, msg }), sendTo: (_c: any, msg: any) => messages.push({ direct: true, msg }), warn: (_c: any, text: string) => warnings.push(text) };
  const c: any = { id: 'editor', throttles: new Map() };
  const msg: PlacementClientMsg = { t: 'placement.set', floor: 'f1', map: 'office', id, transform, request: 1, final: true };
  return { ctx, c, msg, floor, other, messages, warnings };
}
test('handlers broadcast previews/finals on the current floor and send snapshots to late joiners', () => {
  const f = fixture(), handle = placementHandlers['placement.set'];
  handle(f.ctx, f.c, { ...f.msg, final: false });
  assert.equal(f.messages[0].msg.saved, false); assert.equal(f.messages[0].floor, 'f1');
  handle(f.ctx, f.c, f.msg);
  assert.equal(f.messages.at(-1).msg.saved, true);
  assert.deepEqual(placementView!(f.ctx, f.floor as any)?.items[id], transform);
  assert.deepEqual(placementView!(f.ctx, f.other as any)?.items, {});
  handle(f.ctx, f.c, { ...f.msg, floor: 'f2' }); assert.equal(f.warnings.length, 1);
  const count = f.messages.length; handle(f.ctx, f.c, { ...f.msg, id: 'desk-1' }); assert.equal(f.messages.length, count);
  handle(f.ctx, f.c, { ...f.msg, transform: { ...transform, scale: [10, 10, 10] } });
  assert.equal(f.messages.at(-1).msg.t, 'placement.rejected');
  assert.deepEqual(f.messages.at(-1).msg.transform, transform);
});
test('server order resolves concurrent edits and leaving/shutdown flushes previews', () => {
  const f = fixture(), handle = placementHandlers['placement.set'];
  handle(f.ctx, f.c, { ...f.msg, final: false });
  const second = { ...transform, position: [4, 0, 6] };
  handle(f.ctx, { ...f.c, id: 'second', throttles: new Map() }, { ...f.msg, transform: second, final: false });
  const stop = startPlacementClock(f.ctx); stop();
  assert.deepEqual(placements(f.ctx, f.floor as any).store.get(id), second);
  assert.equal(placements(f.ctx, f.floor as any).store.unsaved, false);
  handle(f.ctx, f.c, { ...f.msg, transform: { ...transform, position: [3, 0, 7] }, final: false });
  placementHooks.leaving!(f.ctx, f.c, f.floor as any);
  assert.equal(placements(f.ctx, f.floor as any).store.unsaved, false);
});
test('client ignores stale own echoes, flushes final edits and retries after reconnect', () => {
  const sent: PlacementClientMsg[] = []; let online = true;
  const live = new LivePlacements(msg => sent.push(msg), () => online); live.welcome('f1', 'office');
  live.queue('f1', 'office', id, transform); live.flush('f1', 'office');
  const first = sent.at(-1)!; assert.equal(first.final, true);
  live.queue('f1', 'office', id, { ...transform, position: [4, 0, 5] }); live.flush('f1', 'office');
  const latest = sent.at(-1)!;
  const echo = (m: PlacementClientMsg): PlacementServerMsg => ({ ...m, t: 'placement.changed', by: 'me', saved: true });
  assert.equal(live.receive(echo(first), 'me'), false); assert.ok(live.load('f1', 'office', id));
  online = false; live.disconnected(); const count = sent.length; live.flush('f1', 'office'); assert.equal(sent.length, count);
  online = true; live.welcome('f1', 'office'); assert.equal(sent.at(-1)?.request, latest.request);
  assert.equal(live.receive(echo(latest), 'me'), true); assert.equal(live.load('f1', 'office', id), undefined);
});
