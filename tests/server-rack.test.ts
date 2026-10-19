import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import type { MachineState, ServiceInfo } from '../src/shared/protocol.js';
import {
  RACK_BLADE_SLOTS,
  buildServiceBlades,
  formatGb,
  loadHex,
  loadLevel,
  machineBadge,
  memoryPercent,
  rackHintSummary,
} from '../src/client/shared/server-rack/format.js';
import { stopServicePort, type RackStopResponse } from '../src/client/shared/server-rack/api.js';
import { parseStopPort, stopTrackedService } from '../src/server/server-rack/routes.js';
import { buildServerRack } from '../src/client/features/server-rack/world.js';

const client = (p: string) => readFileSync(new URL(`../src/client/${p}`, import.meta.url), 'utf8');

const sampleMachine: MachineState = {
  cpu: 42,
  cores: 8,
  memUsed: 8 * 2 ** 30,
  memTotal: 16 * 2 ** 30,
  history: [
    [30, 48],
    [42, 50],
  ],
  workers: 3,
  limit: 8,
};

const sampleService: ServiceInfo = {
  port: 5173,
  host: '127.0.0.1',
  pid: 4242,
  command: 'vite --port 5173',
  workerId: 'w-pixel',
  cwd: 'apps/web',
  title: 'Vite App',
  since: 1_700_000_000_000,
};

test('telemetry formatting computes load levels, memory percent, badges and hint summary', () => {
  assert.equal(loadLevel(42), 'ok');
  assert.equal(loadLevel(75), 'warn');
  assert.equal(loadLevel(92), 'critical');
  assert.equal(loadHex(42), '#06d6a0');
  assert.equal(loadHex(75), '#ffd166');
  assert.equal(loadHex(92), '#ef476f');
  assert.equal(formatGb(8 * 2 ** 30), '8.0 GB');
  assert.equal(formatGb(16 * 2 ** 30), '16 GB');
  assert.equal(memoryPercent(sampleMachine), 50);

  assert.deepEqual(machineBadge(sampleMachine), {
    label: '✅ Room to hire (3/8)',
    level: 'ok',
  });
  assert.deepEqual(machineBadge({ ...sampleMachine, workers: 8 }), {
    label: '🚫 Office full (8/8)',
    level: 'warn',
  });
  assert.deepEqual(machineBadge({ ...sampleMachine, pressure: 'CPU is 95% busy' }), {
    label: '⚠️ Under pressure (CPU is 95% busy)',
    level: 'critical',
  });

  assert.equal(rackHintSummary(sampleMachine, 2), '42% CPU · 50% RAM · 2 dev servers');
  assert.equal(rackHintSummary(sampleMachine, 1), '42% CPU · 50% RAM · 1 dev server');
});

test('service blades pad up to RACK_BLADE_SLOTS and expand when more servers run', () => {
  const blades = buildServiceBlades([sampleService]);
  assert.equal(blades.length, RACK_BLADE_SLOTS);
  assert.equal(blades[0].service?.port, 5173);
  assert.equal(blades[1].service, undefined);

  const many = Array.from({ length: 6 }, (_, i) => ({ ...sampleService, port: 3000 + i }));
  const expanded = buildServiceBlades(many);
  assert.equal(expanded.length, 6);
  assert.equal(expanded[5].service?.port, 3005);
});

test('stopServicePort posts port and surfaces server errors', async () => {
  const calls: { url: string; init: RequestInit }[] = [];
  const respond = (body: unknown, ok = true, status = 200) =>
    async (url: string, init: RequestInit): Promise<RackStopResponse> => {
      calls.push({ url, init });
      return { ok, status, json: async () => body };
    };

  const res = await stopServicePort(5173, respond({ ok: true, port: 5173, pid: 4242 }));
  assert.deepEqual(res, { ok: true, port: 5173, pid: 4242 });
  assert.equal(calls[0].url, '/api/server-rack/stop');
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.body, JSON.stringify({ port: 5173 }));

  await assert.rejects(() => stopServicePort(5173, respond({ error: 'No active worker server on :5173.' }, false, 404)), /No active worker server/);
  await assert.rejects(() => stopServicePort(5173, respond({ nope: true })), /unexpected response/);
});

test('server-side stopTrackedService only terminates tracked worker services and scans immediately', async () => {
  assert.equal(parseStopPort({ port: 5173 }), 5173);
  assert.equal(parseStopPort({ port: 0 }), undefined);
  assert.equal(parseStopPort({ port: 70000 }), undefined);
  assert.equal(parseStopPort(null), undefined);

  let scanned = 0;
  const killed: { pid: number; sig: NodeJS.Signals }[] = [];
  const fakeCtx = {
    services: {
      list: () => [sampleService],
      scan: async () => {
        scanned++;
      },
    },
  };

  const missing = await stopTrackedService(fakeCtx as never, 9999, (pid, sig) => killed.push({ pid, sig }));
  assert.deepEqual(missing, { ok: false, status: 404, error: 'No active worker server on :9999.' });
  assert.equal(killed.length, 0);

  const ok = await stopTrackedService(fakeCtx as never, 5173, (pid, sig) => killed.push({ pid, sig }));
  assert.deepEqual(ok, { ok: true, port: 5173, pid: 4242 });
  assert.deepEqual(killed, [{ pid: 4242, sig: 'SIGTERM' }]);
  assert.equal(scanned, 1);
});

test('buildServerRack constructs the 3D fixture and updates blade LEDs with machine and service state', () => {
  const rack = buildServerRack();
  assert.equal(rack.interactable.kind, 'serverrack');
  assert.ok(rack.collider.top > 1.3);
  rack.update(1.5, sampleMachine, 2, false);
  rack.update(2.0, { ...sampleMachine, cpu: 95, pressure: 'CPU is 95% busy' }, 0, true);
});

test('the office and Lite wire the server rack cleanly without Lite loading 3D modules', () => {
  assert.equal(client('main.ts').split('installServerRack(ctx').length - 1, 1);
  assert.match(client('features/server-rack/index.ts'), /interactions\.define\('serverrack'/);
  assert.match(client('world/office/build.ts'), /serverRack,/);
  assert.match(client('lite.html'), /id="btn-server-rack"/);
  assert.match(client('lite.ts'), /openServerRack\(net, openWorker\)/);

  const ui = client('shared/server-rack/ui.ts');
  assert.match(ui, /h\('button\.btn\.close\.corner'/);
  assert.match(ui, /openModal\(el,/);
});
