import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

// Keep this in a child: a leaked timer is only visible after every other handle closes.
test('a launched worker can shut down without waiting for its startup warning', { skip: process.platform === 'win32', timeout: 10000 }, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'office-worker-shutdown-'));
  const binary = path.join(dir, 'fake-agent');
  writeFileSync(binary, `#!${process.execPath}\nsetInterval(() => {}, 1000);\n`, { mode: 0o755 });
  const script = `
    import { WorkerManager } from './src/server/workers.js';
    import { Ledger } from './src/server/usage.js';
    const root = ${JSON.stringify(dir)};
    const ledger = new Ledger(root, { pauseHiring: false }, () => {}, () => {});
    const manager = new WorkerManager(root, root, ${JSON.stringify(binary)}, [],
      { url: 'http://127.0.0.1:1', token: '' },
      { update() {}, remove() {}, data() {}, screen() {}, toast() {} }, ledger);
    const worker = manager.spawn('desk-1', 'test', 'shutdown regression', false, 'agent', 'custom');
    if (typeof worker === 'string') throw new Error(worker);
    manager.shutdown();
    ledger.flush();
    console.log('stopped');
  `;
  try {
    const stdout = await new Promise<string>((resolve, reject) => {
      execFile(process.execPath, ['--import', 'tsx', '--input-type=module', '-e', script],
        { cwd: process.cwd(), timeout: 7000 }, (error, stdout, stderr) => {
          if (error) reject(new Error(`Worker shutdown did not exit promptly: ${error.message}\n${stderr}`));
          else resolve(stdout);
        });
    });
    assert.match(stdout, /stopped/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
