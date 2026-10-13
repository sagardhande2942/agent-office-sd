import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { assignRole, roleAssignment, WORKER_ROLES } from '../src/shared/worker-roles.js';
import { workerRoles } from '../src/server/worker-roles/service.js';
import { featurePrompt } from '../src/server/workers/features.js';
import type { WorkerInfo } from '../src/shared/protocol.js';

test('roles are replaced without losing the task and only recognized at the start', () => {
  assert.equal(assignRole(assignRole('Review login', 'tester'), 'reviewer'), '[Office worker role: reviewer]\nReview login');
  assert.equal(roleAssignment('Example: [Office worker role: developer]'), undefined);
});

test('each role changes delivered responsibilities, persists, can be reassigned and cleared', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'worker-roles-'));
  const worker = { id: 'one', kind: 'agent' } as WorkerInfo;
  try {
    for (const role of Object.keys(WORKER_ROLES) as (keyof typeof WORKER_ROLES)[]) {
      const feature = workerRoles(dir);
      const delivered = feature.prompt!(worker, assignRole('Investigate login', role))!;
      assert.ok(delivered.startsWith('Investigate login\n'));
      assert.ok(delivered.includes(WORKER_ROLES[role].responsibilities));
      assert.ok(workerRoles(dir).prompt!(worker, 'Next task')!.includes(`WORKER ROLE: ${WORKER_ROLES[role].name}`));
    }
    const feature = workerRoles(dir);
    assert.equal(feature.prompt!(worker, assignRole('Implement login', 'none')), 'Implement login');
    assert.equal(workerRoles(dir).prompt!(worker, 'Next task'), 'Next task');
    feature.prompt!(worker, assignRole('Review', 'reviewer'));
    feature.remove!(worker);
    assert.equal(workerRoles(dir).prompt!(worker, 'Next task'), 'Next task');
    const shell = { id: 'shell', kind: 'shell' } as WorkerInfo;
    assert.equal(feature.prompt!(shell, 'echo hello'), 'echo hello');
    assert.equal(feature.prompt!(worker, undefined), undefined);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('worker role feature composes with other prompt features', () => {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'worker-roles-'));
  try {
    const events = { features: [workerRoles(dir), { prompt: (_: WorkerInfo, text?: string) => text + '\nRepository context' }], toast() {} };
    const text = featurePrompt(events as any, { id: 'one', kind: 'agent' } as WorkerInfo, assignRole('Inspect API', 'reviewer'))!;
    assert.match(text, /WORKER ROLE: Reviewer/);
    assert.match(text, /Repository context/);
  } finally { rmSync(dir, { recursive: true, force: true }); }
});
