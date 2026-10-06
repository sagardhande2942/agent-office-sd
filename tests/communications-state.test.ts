import test from 'node:test';
import assert from 'node:assert/strict';
import { Store } from '../src/client/state/store.js';
import { SLICES } from '../src/client/state/slices/index.js';
import { communications } from '../src/client/state/slices/communications.js';
import type { FloorView } from '../src/shared/protocol.js';

test('registered inbox state updates observers and clears when an older floor omits communications', () => {
  const store = new Store(SLICES);
  assert.deepEqual(store.communications, { messages: [] });
  let updates = 0;
  store.on('communications', () => updates++);
  const state = { messages: [], error: 'Ledger unavailable' };
  store.apply({ t: 'communications', state });
  assert.equal(updates, 1);
  assert.equal(store.communications, state);
  communications.enter!(store, { communications: state } as FloorView);
  assert.equal(store.communications, state);
  communications.enter!(store, {} as FloorView);
  assert.deepEqual(store.communications, { messages: [] });
});
