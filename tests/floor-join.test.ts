import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { WebSocket } from 'ws';
import { Building } from '../src/server/building.js';
import { Hosts } from '../src/server/hosts.js';
import { HostRegistry } from '../src/server/floor-hosts.js';
import { FLOORHOST_PROTOCOL } from '../src/shared/floorhost.js';
import { floorJoinCommand, validJoinProject } from '../src/shared/floor-join.js';
import { joinOptions, joinProject, savedJoinToken } from '../src/server/floor-join/cli.js';
import { registerJoinProject } from '../src/server/floor-join/index.js';
import { floorJoinRoutes } from '../src/server/floor-join/routes.js';

test('joiner reads their own checkout and origin, with explicit repo for other remotes', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'floor-join-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  execFileSync('git', ['init', '-q', dir]);
  execFileSync('git', ['-C', dir, 'remote', 'add', 'origin', 'git@github.com:alice/app.git']);
  assert.deepEqual(joinProject(dir), { dir, repo: 'alice/app' });
  assert.equal(joinProject(dir, 'bob/app', ' My floor ').name, 'My floor');
  assert.throws(() => joinProject(path.join(dir, 'missing'), 'alice/app'), /No project directory/);
  assert.throws(() => joinProject(dir, '--evil'), /OWNER\/REPO/);
  assert.throws(() => joinOptions(['--checkout']), /needs a value/);
  assert.throws(() => joinOptions(['--repo', 'alice/app']), /need --checkout/);
  assert.deepEqual(joinOptions(['--office', 'https://office.test', '--checkout', dir]), { rest: ['--office', 'https://office.test'], checkout: dir, repo: undefined, name: undefined, sameOffice: false });
});

test('saved credentials are scoped to the office, with explicit reuse when the same office moves', () => {
  const saved = { office: 'wss://office.test', token: 'saved-token' };
  assert.equal(savedJoinToken(saved, 'https://office.test/', undefined, false), 'saved-token');
  assert.equal(savedJoinToken(saved, 'https://office.test', 'NEW-CODE', false), 'saved-token');
  assert.equal(savedJoinToken(saved, 'https://other.test', 'NEW-CODE', false), undefined);
  assert.equal(savedJoinToken(saved, 'https://other.test', undefined, false), undefined);
  assert.equal(savedJoinToken(saved, 'https://new-ngrok.test', undefined, true), 'saved-token');
  assert.equal(savedJoinToken(saved, 'https://other.test', 'NEW-CODE', true), 'saved-token');
  assert.equal(joinOptions(['--same-office']).sameOffice, true);
});

test('project registration is idempotent, persists, and cannot move another machine’s floor', t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'floor-registration-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const hosts = new Hosts(dir), building = new Building(dir, dir);
  const paired = hosts.pair('admin'); assert.ok(typeof paired !== 'string');
  const claim = hosts.claim(paired.code, 'Alice'); assert.ok(typeof claim !== 'string');
  const project = { dir: 'C:\\somewhere\\app', repo: 'alice/app' };
  const floor = registerJoinProject({ building }, claim.host, project);
  assert.ok(typeof floor !== 'string');
  assert.equal(floor.host, claim.host.id);
  assert.equal(registerJoinProject({ building }, claim.host, project), floor);
  assert.equal(building.list().length, 1);
  assert.equal(new Building(dir, dir).list()[0].dir, project.dir);
  assert.match(String(registerJoinProject({ building }, { ...claim.host, id: 'another' }, project)), /different machine/);
  assert.match(String(registerJoinProject({ building }, claim.host, { ...project, dir: '/different' })), /different machine/);
  assert.match(String(registerJoinProject({ building }, claim.host, { dir: '../secret', repo: 'alice/other' })), /Invalid project/);
  assert.equal(building.list().length, 1);
});

test('both shell command formats quote paths and shell metacharacters', () => {
  const input = { office: 'https://office.test', code: 'ABCD-1234', checkout: "C:\\Alice's projects\\$(secret)`app" };
  const ps = floorJoinCommand(input, 'powershell');
  assert.ok(ps.includes("'C:\\Alice''s projects\\$(secret)`app'"));
  const bash = floorJoinCommand(input, 'bash');
  assert.ok(bash.includes("'C:\\Alice'\\''s projects\\$(secret)`app'"));
  assert.ok(validJoinProject({ dir: '/home/me/app', repo: 'me/app' }));
  assert.ok(!validJoinProject({ dir: '/home/me\n/app', repo: 'me/app' }));
});

test('a checkout enters the welcome during authenticated pairing, not before authentication', async t => {
  const dir = mkdtempSync(path.join(tmpdir(), 'floor-handshake-'));
  const hosts = new Hosts(dir), building = new Building(dir, dir), registry = new HostRegistry(hosts);
  let registrations = 0;
  registry.onAuthenticated = (host, hello) => {
    registrations++;
    const result = registerJoinProject({ building }, host, hello.project);
    return typeof result === 'string' ? result : undefined;
  };
  registry.floorsFor = id => building.list().filter(f => f.host === id);
  const srv = http.createServer();
  srv.on('upgrade', (req, socket, head) => registry.upgrade(req, socket, head, '/floor-host'));
  await new Promise<void>(resolve => srv.listen(0, '127.0.0.1', resolve));
  const sockets: WebSocket[] = [];
  t.after(async () => { sockets.forEach(ws => ws.terminate()); registry.closeAll(); await new Promise<void>(resolve => srv.close(() => resolve())); rmSync(dir, { recursive: true, force: true }); });
  const dial = async (hello: object) => {
    const ws = new WebSocket(`ws://127.0.0.1:${(srv.address() as { port: number }).port}/floor-host`); sockets.push(ws);
    await new Promise<void>((resolve, reject) => { ws.once('open', resolve); ws.once('error', reject); });
    const result = new Promise<any>(resolve => { ws.once('message', raw => resolve(JSON.parse(String(raw)))); ws.once('close', () => resolve(null)); });
    ws.send(JSON.stringify({ t: 'hello', protocol: FLOORHOST_PROTOCOL, ...hello }));
    return result;
  };
  assert.equal(await dial({ token: 'invalid', project: { dir: '/foreign', repo: 'me/app' } }), null);
  assert.equal(registrations, 0);
  const code = hosts.pair('admin'); assert.ok(typeof code !== 'string');
  const welcome = await dial({ code: code.code, name: 'Joiner', project: { dir: '/joiner/app', repo: 'me/app' } });
  assert.equal(welcome.t, 'welcome');
  assert.ok(welcome.token);
  assert.equal(welcome.floors[0].dir, '/joiner/app');
  assert.equal(registrations, 1);
  const second = hosts.pair('admin'); assert.ok(typeof second !== 'string');
  const rejected = await dial({ code: second.code, name: 'Second joiner', project: { dir: '/joiner/app', repo: 'me/app' } });
  assert.match(rejected.joinError, /different machine/);
  assert.ok(rejected.token, 'registration failure still saves a token so the joiner can retry');
});

test('pairing API requires an admin session and same origin; status never leaks credentials', () => {
  const call = (route: any, account: unknown, origin = 'https://office.test') => {
    let status = 0, body: any;
    const res = { writeHead(n: number) { status = n; }, end(data: string) { body = JSON.parse(data); } };
    const ctx = { cfg: { trustProxy: false }, hosts: { pair: () => ({ code: 'ABCD-1234', expiresAt: 1 }), list: () => [{ id: 'a', name: 'Alice', hash: 'secret' }] }, registry: { counts: () => new Map(), isReachable: () => false }, building: { list: () => [] } };
    route.handle(ctx, { session: { account }, req: { headers: { origin, host: 'office.test' } }, res });
    return { status, body };
  };
  assert.equal(call(floorJoinRoutes.pair, { role: 'member' }).status, 403);
  assert.equal(call(floorJoinRoutes.pair, { role: 'admin' }, 'https://evil.test').status, 403);
  assert.equal(call(floorJoinRoutes.pair, undefined).status, 200);
  assert.equal(call(floorJoinRoutes.status, { role: 'member' }).status, 403);
  assert.deepEqual(call(floorJoinRoutes.status, undefined).body.machines[0], { id: 'a', name: 'Alice', connected: false, floors: [] });
});
