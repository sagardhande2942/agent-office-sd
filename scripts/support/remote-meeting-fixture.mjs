import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { WebSocket } from 'ws';
import { Hosts } from '../../src/server/hosts.ts';
import { HostFloors, hostParts, startHooks } from '../../src/server/host-floor.ts';
import { FLOORHOST_PROTOCOL } from '../../src/shared/floorhost.ts';
import { loadConfig } from '../../src/server/config.ts';
import { startServer } from '../../src/server/server.ts';
export async function remoteMeetingFixture() {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'office-remote-meetings-'));
  const project = path.join(home, 'project'); fs.mkdirSync(project);
  const git = (...args) => execFileSync('git', args, { cwd: project, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git('init', '-b', 'main'); git('config', 'user.name', 'Fixture'); git('config', 'user.email', 'fixture@example.test');
  fs.writeFileSync(path.join(project, 'README.md'), '# Remote meeting fixture\n'); git('add', 'README.md'); git('commit', '-m', 'fixture');
  const command = path.join(home, 'claude');
  fs.writeFileSync(command, `#!${process.execPath}\nif(process.argv.includes('-p')||process.argv.includes('--print')){console.log(JSON.stringify({name:'Meeting task',summary:'Fixture'}));process.exit(0);}setInterval(()=>{},1000);\n`, { mode: 0o755 });
  const cfg = loadConfig(['--home', home, '--port', '4600', '--password', 'remote-meetings', '--max-workers', '6', '--no-open']); cfg.port = 0;
  const hosts = new Hosts(cfg.dataDir), paired = hosts.claim(hosts.pair('Tester').code, 'Meeting laptop');
  fs.writeFileSync(path.join(cfg.dataDir, 'floors.json'), JSON.stringify([{ id: 'remote-meetings', name: 'Remote meetings', dir: project, palette: 0, addedBy: 'Tester', addedAt: Date.now(), host: paired.host.id }]));
  const office = await startServer(cfg, { publicDir: path.resolve('dist/public') });
  const base = `http://127.0.0.1:${office.server.address().port}`;
  let host, socket;
  const hooks = await startHooks(id => host?.workersOf(id), { floorOf: id => host?.floorOf(id), changed: floor => host?.reportCinema(floor.id, floor), publish: (floor, msg) => host?.reportWorkerFeature(floor.id, msg) });
  const wait = async check => { const end = Date.now() + 15000; while (!check() && Date.now() < end) await new Promise(r => setTimeout(r, 25)); if (!check()) throw Error('Fixture condition timed out'); };
  const connect = async () => {
    socket = new WebSocket(base.replace('http:', 'ws:') + '/floor-host');
    const send = msg => socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify(msg));
    host = new HostFloors(hostParts({ dataDir: path.join(home, 'host-data'), agentCmd: command, agentArgs: [], dshProfile: 'acp' }, send, hooks.url, 4));
    socket.on('open', () => send({ t: 'hello', hostId: paired.host.id, token: paired.token, protocol: FLOORHOST_PROTOCOL }));
    socket.on('message', raw => { const msg = JSON.parse(String(raw)); if (msg.t === 'welcome') void host.open(msg.floors); else void host.call(msg); });
    await wait(() => !!host.floors.get('remote-meetings')?.project);
    await host.floors.get('remote-meetings').ready;
    await wait(() => !!host.floors.get('remote-meetings').meetings.state().spaces);
  };
  try {
    await connect();
    git('add', '.gitignore', '.agent-office/knowledge'); git('commit', '-m', 'seed knowledge');
  } catch (e) { host?.shutdown(); socket?.terminate(); hooks.close(); office.shutdown(); throw e; }
  const saved = () => JSON.parse(fs.readFileSync(path.join(project, '.agent-office', 'workers.json'), 'utf8'));
  return {
    home, project, office, hooks, base, wait, git,
    get floor() { return host.floors.get('remote-meetings'); },
    async tool(id, action, body, badToken = false) {
      const token = saved().find(w => w.id === id)?.hookToken;
      const response = await fetch(`${hooks.url}/office/workers${action}?worker=${id}`, { method: body ? 'POST' : 'GET', headers: { authorization: `Bearer ${badToken ? 'wrong' : token}`, 'content-type': 'application/json' }, ...(body ? { body: JSON.stringify(body) } : {}) });
      return { status: response.status, body: await response.json() };
    },
    async restartHost() { host.shutdown(); socket.terminate(); await new Promise(r => setTimeout(r, 250)); await connect(); },
    async close() { host.shutdown(); socket.terminate(); hooks.close(); office.shutdown(); await new Promise(r => setTimeout(r, 250)); fs.rmSync(home, { recursive: true, force: true }); },
  };
}
