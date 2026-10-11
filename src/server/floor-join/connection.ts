import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { WebSocket } from 'ws';
import { FLOORHOST_PROTOCOL, isToOffice, type FromFloor } from '../../shared/floorhost.js';
import { HostFloors, hostParts, startHooks } from '../host-floor.js';
import type { FloorJoinProject } from '../../shared/floor-join.js';
import type { AttemptResult } from './retry.js';

export interface ConnectionOptions {
  token?: string; code?: string; name?: string; owner?: string;
  configFile: string; seats: number; projects: string; project?: FloorJoinProject;
}
function saveConfig(file: string, cfg: { office: string; token: string; hostId: string; project?: FloorJoinProject }) {
  writeFileSync(file, JSON.stringify(cfg, null, 2), { mode: 0o600 });
}

export async function connectOnce(
  url: string,
  opts: ConnectionOptions,
  signal: AbortSignal,
  authenticated: () => void,
): Promise<AttemptResult> {
  return new Promise<AttemptResult>((resolve) => {
    let ws: WebSocket;
    try { ws = new WebSocket(url, { handshakeTimeout: 10_000 }); }
    catch (err) { console.error(`floor-host: ${(err as Error).message}`); return resolve({ code: 1, retry: false }); }
    let settled = false;
    let welcomed = false;
    let alive = true;
    const heartbeat = setInterval(() => {
      if (ws.readyState !== WebSocket.OPEN) return;
      if (!alive) { console.error('floor-host: office heartbeat timed out'); done(1, true); return; }
      alive = false; ws.ping();
    }, 15_000);
    ws.on('pong', () => { alive = true; });
    let servePromise: Promise<void> | undefined;
    const handshake = setTimeout(() => { console.error('floor-host: timed out waiting for the office'); done(1, true); }, 20_000);
    const done = (code: number, retry = false) => {
      if (settled) return;
      settled = true;
      clearTimeout(handshake); clearInterval(heartbeat);
      signal.removeEventListener('abort', cancelled);
      ws.terminate();
      // Wait for any in-flight hook/floor opening before shutting it down; retries must not leak listeners.
      void (servePromise ?? Promise.resolve()).catch(() => {}).then(() => {
        stopHooks?.(); host?.shutdown();
        resolve({ code, retry });
      });
    };
    const cancelled = () => done(0);
    signal.addEventListener('abort', cancelled, { once: true });
    // The floors this machine serves, built once the office says which ones it wants. `send` is bound
    // to the socket here rather than passed in, so a frame that arrives before the connection is ready
    // is dropped rather than queued against a socket that does not exist yet.
    let host: HostFloors | undefined;
    let stopHooks: (() => void) | undefined;
    const send = (msg: FromFloor) => {
      if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
    };

    ws.on('open', () => {
      if (settled) return;
      console.log(`floor-host: connected to ${url}`);
      send({
        t: 'hello',
        hostId: '',
        protocol: FLOORHOST_PROTOCOL,
        token: opts.token,
        code: opts.code,
        name: opts.name,
        owner: opts.owner,
        projectsDir: opts.projects,
        project: opts.project,
      });
    });

    ws.on('message', (raw) => {
      if (settled) return;
      let msg: unknown;
      try {
        msg = JSON.parse(String(raw));
      } catch {
        return;
      }
      if (!isToOffice(msg)) return;

      if (msg.t === 'welcome') {
        if (welcomed) return;
        welcomed = true;
        clearTimeout(handshake);
        if (msg.token) { opts.token = msg.token; opts.code = undefined; }
        if (msg.token || opts.token) {
          try { saveConfig(opts.configFile, { office: url.replace(/\/floor-host$/, ''), token: msg.token || opts.token!, hostId: msg.hostId, project: opts.project }); }
          catch (err) { console.error("floor-host: could not save the pairing token: " + (err as Error).message); return done(1); }
          console.log(`floor-host: paired. Token kept in ${opts.configFile} (0600).`);
        }
        if (msg.joinError) { console.error(`floor-host: ${msg.joinError}`); return done(1); }
        if (opts.project && !msg.floors.some(f => f.dir === opts.project!.dir)) {
          console.error('floor-host: this office did not register the checkout. Update the office to support --checkout.');
          return done(1);
        }
        console.log(`floor-host: the office asks for ${msg.floors.length} floor(s) on this machine`);
        authenticated();
        servePromise = serve(msg.floors);
        servePromise.catch((err: Error) => {
          // An unhandled rejection here would leave the machine connected and serving nothing, which
          // looks exactly like working. Say what broke and stop.
          console.error(`floor-host: couldn't open the floors — ${err.message}`);
          done(1);
        });
        return;
      }
      if (msg.t === 'bye') {
        if (msg.why) {
          console.error(`floor-host: the office refused this machine — ${msg.why}`);
          return done(1);
        }
        console.log('floor-host: the office is shutting down');
        return done(1, true);
      }
      // Everything else is the office asking this machine to do something on a floor it is serving.
      if (host) {
        void host.call(msg);
        return;
      }
      // A call that arrives while the floors are still opening. Answering it is the whole point:
      // dropping it leaves the office waiting out its twenty-second timeout for a reply that is never
      // coming, which reads to whoever asked as a machine that has hung.
      if ('floorId' in msg && typeof msg.floorId === 'string' && 'seq' in msg && typeof msg.seq === 'number') {
        send({ t: 'refused', floorId: msg.floorId, reason: `still opening its floors on this machine`, seq: msg.seq });
      }
    });

    /** Opens the floors the office wants, with a hook endpoint this machine's workers report to. */
    async function serve(wanted: { id: string; dir: string; name: string }[]) {
      const dataDir = hostDataDir(opts.configFile);
      mkdirSync(dataDir, { recursive: true, mode: 0o700 });
      const settings = {
        dataDir,
        agentCmd: process.env.AGENT_OFFICE_AGENT || 'claude',
        agentArgs: [],
        dshProfile: process.env.AGENT_OFFICE_DSH_PROFILE || 'acp',
      };
      // The hook listener first: `launch` puts its URL in a worker's environment, so it must exist
      // before any worker starts. It looks workers up through this closure, which is why it can start
      // before the floors are open. Loopback only, and nothing is forwarded (see startHooks).
      const hooks = await startHooks((workerId) => host?.floorOf(workerId)?.workers, {
        floorOf: id => host?.floorOf(id),
        changed: floor => host?.reportCinema(floor.id, floor),
        publish: (floor, msg) => host?.reportWorkerFeature(floor.id, msg),
      }, (req, res, url) => host?.teams.hook(req, res, url, id => host?.floorOf(id)) ?? Promise.resolve(false));
      stopHooks = hooks.close;
      if (settled) return;

      const present = wanted.filter((w) => existsSync(w.dir));
      for (const missing of wanted.filter((w) => !existsSync(w.dir))) {
        console.error(`floor-host: ${missing.name}: no checkout at ${missing.dir} on this machine — skipping`);
      }
      if (!present.length) {
        console.error('floor-host: nothing to serve — no floor the office asked for has a checkout here');
        return done(1);
      }
      host = new HostFloors(hostParts(settings, send, hooks.url, opts.seats));
      // Told to the office in every `ready`, so `agent-office hosts add-floor` on the office can
      // suggest `<this>/owner/repo` for a floor it is about to point at this machine.
      host.projectsDir = opts.projects;
      await host.open(present);
    }

    ws.on('close', () => {
      if (!settled) {
        console.error('floor-host: the office closed the connection');
        done(1, true);
      }
    });
    ws.on('error', (err) => {
      console.error(`floor-host: ${(err as Error).message}`);
      done(1, true);
    });

    if (signal.aborted) cancelled();
  });
}

/** Where a host keeps its own data: its token, its floors' scrollback, and this machine's ledger. */
function hostDataDir(configFile: string): string {
  return path.join(path.dirname(configFile), '.agent-office-floor-host');
}
