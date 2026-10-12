import test from 'node:test';
import assert from 'node:assert/strict';
import { bossInitial } from '../src/shared/boss-mode/config';
import { promptDiscovery, recordSteering, steeringMessage } from '../src/server/boss-mode/steering';
import { teamPromptError } from '../src/server/master-workers/role';
import type { WorkerInfo } from '../src/shared/protocol';

test('discovery prompts use the managed participant route and reject other team workers', () => {
  const state = bossInitial();
  state.discovery = { id: 'token', workerId: 'discovery', startedAt: 0 };
  const info = { masterWorkers: { id: 'boss-discovery-token', role: 'master' } } as WorkerInfo;
  const sent: string[] = [];
  const workers = { get: () => info, prompt: (_id: string, text: string, by: string) => {
    const error = teamPromptError(info, by);
    if (error) return error;
    sent.push(text);
  } };
  assert.ok(teamPromptError(info, 'Boss mode'), 'old route rejects managed workers');
  assert.equal(promptDiscovery(state, workers, 'discovery', 'Build the car'), undefined);
  assert.deepEqual(sent, ['Build the car']);
  assert.match(promptDiscovery(state, workers, 'another-master', 'wrong')!, /Not the active/);
  info.masterWorkers!.id = 'unrelated-team';
  assert.match(promptDiscovery(state, workers, 'discovery', 'wrong')!, /Not the active/);
  assert.equal(sent.length, 1);
});

test('multiple instructions retain their order and explicitly give newer direction precedence', () => {
  const state = bossInitial(); state.config.mission = 'Add a new car';
  recordSteering(state, 'Inspect a possible repair', 1);
  recordSteering(state, 'Build the car first', 2);
  const message = steeringMessage(state, state.steering);
  assert.ok(message.indexOf('Inspect a possible repair') < message.indexOf('Build the car first'));
  assert.match(message, /newer instructions supersede conflicting older ones/);
  assert.match(message, /Current mission: Add a new car/);
});
