import test from 'node:test';
import assert from 'node:assert/strict';
import { bossInitial } from '../src/shared/boss-mode/config';
import { bossConnection } from '../src/client/shared/boss-mode/connection';

test('the console distinguishes connecting, supported and confirmed unsupported hosts', () => {
  const state = { ...bossInitial(), connection: 'connecting' as const };
  assert.match(bossConnection(state, true).text, /Connecting to floor host/);
  assert.equal(bossConnection(state, true).ready, false);
  assert.match(bossConnection({ ...state, connection: 'unsupported' }, true, false).text, /Reconnecting/);
  assert.match(bossConnection({ ...state, connection: 'unsupported' }, true, true).text, /does not support/);
  assert.equal(bossConnection({ ...state, connection: 'ready' }, true, true).ready, true);
  assert.equal(bossConnection(bossInitial(), true).ready, true, 'local offices need no host handshake');
  assert.match(bossConnection(state, false).text, /Connecting to office/);
});
