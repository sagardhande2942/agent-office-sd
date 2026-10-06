import readline from 'node:readline';
import { WebSocket } from 'ws';
import { DESKS, WING_DESKS } from '../shared/layout.js';
import { isAgentProvider, type ClientMsg, type FloorInfo, type FloorView, type ServerMsg, type WorkerInfo } from '../shared/protocol.js';

const HELP = `Usage: agent-office tui [--office http://localhost:4600] [--name NAME] [--floor ID]

Join a running office from your terminal. Password: AGENT_OFFICE_PASSWORD, or a hidden prompt.
Use --name for an account login; omit it for the shared office password.

Commands:
  workers / floors / go <floor ID or name>
  hire <provider> [prompt]     Hire at the first empty desk
  attach <worker ID or name>  Live terminal; Ctrl+] returns to the office
  prompt <worker> <text> / resume <worker> / pr <worker>
  issues / pulls / queue / enqueue <prompt> / chat <text>
  help / quit

The office keeps running when you leave. Requires an interactive terminal.`;

/** Strip terminal controls from untrusted dashboard labels. PTY output is intentionally raw. */
export function plain(value: string): string {
  return value.replace(/\x1b\[[0-?]*[ -/]*[@-~]/g, '').replace(/[\x00-\x1f\x7f-\x9f]/g, '');
}

async function passwordPrompt(): Promise<string> {
  process.stdout.write('Office password: ');
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = '';
    const input = (chunk: Buffer) => {
      for (const char of chunk.toString()) {
        if (char === '\r' || char === '\n' || char === '\x03') {
          process.stdin.off('data', input);
          process.stdin.setRawMode(false);
          process.stdout.write('\n');
          if (char === '\x03') reject(new Error('Cancelled'));
          else resolve(value);
          return;
        }
        if (char === '\x7f' || char === '\b') value = value.slice(0, -1);
        else if (char >= ' ') value += char;
      }
    };
    process.stdin.on('data', input);
  });
}

export async function tuiCommand(argv: string[]): Promise<number> {
  let office = 'http://localhost:4600', name = '', floor = '';
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--help' || argv[i] === '-h') { console.log(HELP); return 0; }
    if (!['--office', '--name', '--floor'].includes(argv[i]) || !argv[i + 1] || argv[i + 1].startsWith('--')) {
      console.error(`agent-office tui: unknown option or missing value: ${argv[i]}`); return 1;
    }
    const option = argv[i], value = argv[++i];
    if (option === '--office') office = value;
    if (option === '--name') name = value;
    if (option === '--floor') floor = value;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) { console.error('agent-office tui requires an interactive terminal'); return 1; }
  try {
    const base = new URL(office);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
      throw new Error('--office must be an http(s) origin, such as http://localhost:4600');
    }
    const password = process.env.AGENT_OFFICE_PASSWORD ?? await passwordPrompt();
    const response = await fetch(new URL('/api/login', base), {
      method: 'POST', headers: { 'content-type': 'application/json', origin: base.origin },
      body: JSON.stringify({ name, password }), redirect: 'error', signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error(`Sign-in failed (${response.status})`);
    const cookie = response.headers.getSetCookie().map((c) => c.split(';')[0]).join('; ');
    if (!cookie) throw new Error('The office did not issue a session');
    const url = new URL('/ws', base);
    url.protocol = base.protocol === 'https:' ? 'wss:' : 'ws:';
    url.search = new URLSearchParams({ name: name || 'CLI', color: '#06d6a0', lite: '1', ...(floor ? { floor } : {}) }).toString();
    return await session(new WebSocket(url, { headers: { Cookie: cookie, Origin: base.origin }, handshakeTimeout: 15_000 }));
  } catch (err) {
    console.error(`agent-office tui: ${(err as Error).message}`); return 1;
  }
}

function session(ws: WebSocket): Promise<number> {
  return new Promise((resolve) => {
    let view: FloorView | undefined, floors: FloorInfo[] = [], attached: string | undefined;
    let rl: readline.Interface | undefined, finished = false;
    const send = (message: ClientMsg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); };
    const print = (text: string) => { if (!attached) { console.log(plain(text)); rl?.prompt(true); } };
    const workers = () => print(`\n${view?.project?.dir ?? 'No project floor'}\n${view?.workers.map((w) => `${w.id}  ${w.name}  ${w.status}  ${w.task?.name ?? w.activity ?? ''}`).join('\n') || 'No workers. Use hire <provider> [prompt].'}`);
    const worker = (key: string): WorkerInfo => {
      const matches = view?.workers.filter((w) => w.id === key || w.name.toLowerCase() === key.toLowerCase()) ?? [];
      if (matches.length !== 1) throw new Error('Use a unique worker ID or name from workers');
      return matches[0];
    };
    const resize = () => { if (attached) send({ t: 'term.resize', workerId: attached, cols: process.stdout.columns, rows: process.stdout.rows }); };
    const detach = () => {
      if (!attached) return;
      send({ t: 'worker.detach', workerId: attached }); attached = undefined;
      process.stdin.off('data', terminalInput); process.stdin.setRawMode(false);
      process.stdout.write('\x1b[0m\x1b[?25h\x1b[?1049l');
      openPrompt(); workers();
    };
    const terminalInput = (chunk: Buffer) => {
      const data = chunk.toString(), escape = data.indexOf('\x1d');
      if (escape >= 0) { if (escape > 0 && attached) send({ t: 'term.input', workerId: attached, data: data.slice(0, escape) }); detach(); }
      else if (attached) send({ t: 'term.input', workerId: attached, data });
    };
    const done = (code: number) => {
      if (finished) return;
      finished = true; detach(); rl?.close(); process.stdin.pause();
      process.stdout.off('resize', resize); process.off('SIGTERM', stop); process.off('SIGINT', stop);
      ws.close(); const timer = setTimeout(() => ws.terminate(), 1000); timer.unref(); resolve(code);
    };
    const stop = () => done(0);
    process.on('SIGTERM', stop); process.on('SIGINT', stop); process.stdout.on('resize', resize);
    ws.on('error', (err) => { print(err.message); done(1); });
    ws.on('close', () => { if (!finished) { print('Disconnected from the office. Run agent-office tui to reconnect.'); done(1); } });
    ws.on('message', (raw) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg.t === 'welcome' || msg.t === 'floor.enter') {
        detach(); view = msg;
        if (msg.t === 'welcome') {
          floors = msg.floors;
          openPrompt();
          print('Agent Office CLI — type help for commands.');
        }
        workers();
      } else if (msg.t === 'floors') floors = msg.floors;
      else if (msg.t === 'worker.update' && view) {
        view.workers = [...view.workers.filter((w) => w.id !== msg.worker.id), msg.worker];
        print(`${msg.worker.name}: ${msg.worker.status}`);
      } else if (msg.t === 'worker.remove' && view) {
        if (attached === msg.workerId) detach();
        view.workers = view.workers.filter((w) => w.id !== msg.workerId);
      } else if ((msg.t === 'term.snapshot' || msg.t === 'term.data') && attached === msg.workerId) process.stdout.write(msg.data);
      else if (msg.t === 'gh.issues' && view) view.issues = msg.state;
      else if (msg.t === 'gh.pulls' && view) view.pulls = msg.state;
      else if (msg.t === 'queue' && view) view.queue = msg.state;
      else if (msg.t === 'plan' && view) view.plan = msg.plan;
      else if (msg.t === 'toast') print(`${msg.level}: ${msg.text}`);
      else if (msg.t === 'chat') print(`${msg.name}: ${msg.text}`);
    });
    function openPrompt() {
      if (finished) return;
      rl = readline.createInterface({ input: process.stdin, output: process.stdout, prompt: 'office> ' });
      rl.on('SIGINT', stop);
      const current = rl;
      rl.on('close', () => { if (rl === current) done(0); });
      rl.on('line', (line) => {
        if (attached) return;
        try { command(line.trim()); } catch (err) { print((err as Error).message); }
        if (!attached && !finished) rl?.prompt();
      });
    }
    function command(line: string) {
      const [cmd, key = '', ...tail] = line.split(/\s+/), text = tail.join(' ');
      if (!cmd) return;
      if (cmd === 'quit' || cmd === 'exit') return done(0);
      if (cmd === 'help') return print(HELP);
      if (cmd === 'workers') return workers();
      if (cmd === 'floors') return print(floors.map((f) => `${f.id === view?.floor ? '*' : ' '} ${f.id}  ${f.name}`).join('\n'));
      if (cmd === 'go') {
        const target = [key, ...tail].join(' ');
        const found = floors.filter((f) => f.id === target || f.name === target);
        if (found.length !== 1) throw new Error('Use a unique floor ID or name from floors');
        return send({ t: 'floor.go', floor: found[0].id });
      }
      if (!view?.floor) throw new Error('Add a project in the browser, then select it with go');
      if (cmd === 'hire') {
        if (!isAgentProvider(key)) throw new Error('Provider: claude, codex, opencode, grok, muse, dsh or custom');
        const desk = [...DESKS, ...WING_DESKS.filter((d) => d.wing! <= view!.plan.wing)].find((d) => !view!.workers.some((w) => w.deskId === d.id));
        if (!desk) throw new Error('No empty desk on this floor');
        return send({ t: 'worker.spawn', deskId: desk.id, provider: key, prompt: text || undefined });
      }
      if (cmd === 'chat' || cmd === 'enqueue') {
        const body = [key, ...tail].join(' ').trim(); if (!body) throw new Error('Provide some text');
        return send(cmd === 'chat' ? { t: 'chat', text: body } : { t: 'queue.add', prompt: body });
      }
      if (cmd === 'issues' || cmd === 'pulls') {
        const state = cmd === 'issues' ? view.issues : view.pulls;
        return print(state.items.map((item) => `#${item.number} ${item.title}`).join('\n') || 'No items');
      }
      if (cmd === 'queue') return print(view.queue.tasks.map((t) => `${t.status}  ${t.title}`).join('\n') || 'Queue is empty');
      if (['attach', 'prompt', 'resume', 'pr'].includes(cmd)) {
        const w = worker(key);
        if (cmd === 'attach') {
          attached = w.id; const previous = rl; rl = undefined; previous?.close(); process.stdin.setRawMode(true); process.stdin.on('data', terminalInput); process.stdin.resume();
          process.stdout.write('\x1b[?1049h\x1b[2J\x1b[H');
          send({ t: 'worker.attach', workerId: w.id }); resize(); return;
        }
        if (cmd === 'prompt') { if (!text) throw new Error('Provide a prompt'); return send({ t: 'worker.prompt', workerId: w.id, prompt: text }); }
        return send({ t: cmd === 'pr' ? 'worker.pr' : 'worker.resume', workerId: w.id });
      }
      throw new Error('Unknown command. Type help.');
    }
  });
}
