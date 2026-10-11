import { randomBytes } from 'node:crypto';
import { closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ResearchStore } from './store.js';
import { DiscoveryAdapter } from './adapter.js';
import { ResearchScheduler } from './scheduler.js';
import { researchServer } from './server.js';

export async function main(args = process.argv.slice(2)) {
  const options: Record<string, string> = {};
  const allowed = ['tradeai', 'python', 'data', 'port', 'concurrency', 'orcatrex', 'remote-python', 'remote-directory'];
  if (args.includes('--help')) {
    console.log('office-research --tradeai <Tradeai directory> [--python <Python executable>] [--data <journal directory>] [--port 4601] [--concurrency 2] [--orcatrex <URL>] [--remote-python python3] [--remote-directory git]'); return;
  }
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i].replace(/^--/, '');
    if (!args[i].startsWith('--') || !allowed.includes(key) || !args[i + 1]) throw Error(`Unknown or incomplete option: ${args[i]}`);
    options[key] = args[i + 1];
  }
  if (!options.tradeai) throw Error('Provide --tradeai with the existing Tradeai directory');
  const tradeai = path.resolve(options.tradeai);
  if (!existsSync(path.join(tradeai, 'discovery/evaluate_strategy.py'))) throw Error('Tradeai checkout must contain discovery/evaluate_strategy.py');
  const port = Number(options.port ?? 4601), concurrency = Number(options.concurrency ?? 2);
  if (!Number.isInteger(port) || port < 1 || port > 65535 || !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw Error('Invalid port or concurrency (1–8)');
  if (options.orcatrex) {
    const u = new URL(options.orcatrex);
    if (!['http:', 'https:'].includes(u.protocol) || u.username || u.password || u.search || u.hash) throw Error('Provide an OrcaTrex HTTP(S) URL');
    options.orcatrex = u.toString().replace(/\/$/, '');
  }
  const dir = path.resolve(options.data ?? path.join(os.homedir(), '.agent-office/research'));
  mkdirSync(dir, { recursive: true });
  const lock = path.join(dir, 'coordinator.pid');
  if (existsSync(lock)) {
    const pid = Number(readFileSync(lock, 'utf8'));
    if (!Number.isInteger(pid) || pid < 1) throw Error('Invalid coordinator lock; inspect it before starting');
    let running = true;
    try { process.kill(pid, 0); } catch (error) { if ((error as NodeJS.ErrnoException).code === 'ESRCH') running = false; }
    if (running) throw Error('A coordinator already owns this journal');
    unlinkSync(lock);
  }
  const fd = openSync(lock, 'wx', 0o600); writeFileSync(fd, String(process.pid)); closeSync(fd);
  const clean = () => { try { unlinkSync(lock); } catch { /* already released */ } };
  try {
    const tokenFile = path.join(dir, 'coordinator.token');
    const token = existsSync(tokenFile) ? readFileSync(tokenFile, 'utf8').trim() : randomBytes(32).toString('hex');
    if (!existsSync(tokenFile)) writeFileSync(tokenFile, token, { mode: 0o600 });
    const store = new ResearchStore(dir), script = fileURLToPath(new URL('../../../../../bin/research-evaluate.py', import.meta.url));
    const adapter = new DiscoveryAdapter({ tradeai, python: options.python ?? (process.platform === 'win32' ? 'python' : 'python3'), script,
      orcatrex: options.orcatrex, remotePython: options['remote-python'], remoteDirectory: options['remote-directory'] }, store);
    const scheduler = new ResearchScheduler(store, adapter, concurrency), server = researchServer(store, token);
    await new Promise<void>((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', resolve); });
    scheduler.start();
    console.log(`Research coordinator: http://127.0.0.1:${port}\nToken file: ${tokenFile}\nJournal: ${dir}\nGeneration: Office workers or manual submissions; paid AI APIs are disabled.`);
    let stopping = false;
    const stop = async () => { if (stopping) return; stopping = true; await scheduler.stop(); server.close(); clean(); };
    process.once('SIGINT', stop); process.once('SIGTERM', stop); process.once('exit', clean);
  } catch (error) { clean(); throw error; }
}
