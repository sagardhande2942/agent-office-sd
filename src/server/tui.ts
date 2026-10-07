import { teamCommand } from './master-workers/tui.js';
import { readFileSync } from 'node:fs';
import readline from 'node:readline';
import { WebSocket } from 'ws';
import { PANELS, communicationLines, gridColumns, plain, renderDashboard, seats, type Dashboard, type Panel } from './tui-dashboard.js';
export { plain } from './tui-dashboard.js';
import { isAgentProvider, type ClientMsg, type FloorInfo, type FloorView, type ServerMsg, type WorkerInfo } from '../shared/protocol.js';

const HELP = `Usage: agent-office tui [--office http://localhost:4600] [--name NAME] [--floor ID]

Join a running office from your terminal. Password: AGENT_OFFICE_PASSWORD, or a hidden prompt.
Use --name for an account login; omit it for the shared office password.

Live dashboard: arrows select desks, Enter opens a worker, Tab changes panels.
Press : for the command prompt; Ctrl+] leaves an attached terminal.

Commands:
  workers / floors / go <floor ID or name>
  hire <provider> [prompt]     Hire at the first empty desk
  attach <worker ID or name>  Live terminal; Ctrl+] returns to the office
  prompt <worker> <text> / resume <worker> / pr <worker>
  home <worker> [--cleanup auto|keep|worktree|all]  Send a worker home
  messages [request-id]       Read tracked worker requests and replies
  issues / pulls / queue / enqueue <prompt> / chat <text>
  teams / team-start <JSON-file> / team-pause / team-resume / team-stop
  team-preset <JSON-file> / team-preset-delete <ID>
  help / quit

The office keeps running when you leave. Requires an interactive terminal.`;

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
    let finished = false, active = false;
    const dashboard: Dashboard = { floors, selected: 0, panel: 'office', offset: 0, notice: 'Connecting to the office...' };
    const send = (message: ClientMsg) => { if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(message)); };
    const draw = () => {
      if (attached || finished || !active) return;
      dashboard.view = view; dashboard.floors = floors;
      dashboard.selected = Math.max(0, Math.min(dashboard.selected, seats(view).length - 1));
      process.stdout.write('\x1b[?25l\x1b[H\x1b[2J' + renderDashboard(dashboard, process.stdout.columns || 80, process.stdout.rows || 24));
    };
    const print = (text: string) => { dashboard.notice = plain(text); draw(); };
    const panel = (next: Panel) => { dashboard.panel = next; dashboard.offset = 0; dashboard.thread = undefined; draw(); };
    const workers = () => panel('office');
    const worker = (key: string): WorkerInfo => {
      const matches = view?.workers.filter((w) => w.id === key || w.name.toLowerCase() === key.toLowerCase()) ?? [];
      if (matches.length !== 1) throw new Error('Use a unique worker ID or name from workers');
      return matches[0];
    };
    const resize = () => { if (attached) send({ t: 'term.resize', workerId: attached, cols: process.stdout.columns || 80, rows: process.stdout.rows || 24 }); else draw(); };
    const detach = () => {
      if (!attached) return;
      send({ t: 'worker.detach', workerId: attached }); attached = undefined;
      process.stdout.write('\x1b[0m\x1b[?25l');
      draw();
    };
    const input = (chunk: Buffer) => {
      if (!attached) return;
      const data = chunk.toString(), escape = data.indexOf('\x1d');
      if (escape >= 0) { if (escape > 0) send({ t: 'term.input', workerId: attached, data: data.slice(0, escape) }); detach(); }
      else send({ t: 'term.input', workerId: attached, data });
    };
    const done = (code: number) => {
      if (finished) return;
      finished = true; detach();
      process.stdin.off('data', input); process.stdin.off('keypress', keypress);
      if (process.stdin.isTTY) process.stdin.setRawMode(false);
      process.stdin.pause();
      if (active) process.stdout.write('\x1b[0m\x1b[?25h\x1b[?1049l');
      process.stdout.off('resize', resize); process.off('SIGTERM', stop); process.off('SIGINT', stop);
      ws.close(); const timer = setTimeout(() => ws.terminate(), 1000); timer.unref(); resolve(code);
    };
    const stop = () => done(0);
    process.on('SIGTERM', stop); process.on('SIGINT', stop); process.stdout.on('resize', resize);
    ws.on('error', (err) => { done(1); console.error(`agent-office tui: ${err.message}`); });
    ws.on('close', () => { if (!finished) { done(1); console.error('Disconnected from the office. Run agent-office tui to reconnect.'); } });
    ws.on('message', (raw) => {
      let msg: ServerMsg;
      try { msg = JSON.parse(String(raw)); } catch { return; }
      if (msg.t === 'welcome' || msg.t === 'floor.enter') {
        detach(); dashboard.home = undefined; view = msg;
        if (msg.t === 'welcome') {
          floors = msg.floors;
          active = true;
          process.stdout.write('\x1b[?1049h\x1b[?25l');
          readline.emitKeypressEvents(process.stdin);
          process.stdin.setRawMode(true);
          process.stdin.on('data', input); process.stdin.on('keypress', keypress); process.stdin.resume();
          print('Welcome. Select a desk with arrows; Enter opens its terminal.');
        }
        dashboard.selected = 0; dashboard.offset = 0; draw();
      } else if (msg.t === 'master-workers' && view) view.masterWorkers=msg.state;
      else if (msg.t === 'plan-review' && view) view.planReview=msg.state;
      else if (msg.t === 'floors') floors = msg.floors;
      else if (msg.t === 'worker.update' && view) {
        view.workers = [...view.workers.filter((w) => w.id !== msg.worker.id), msg.worker];
        print(`${msg.worker.name}: ${msg.worker.status}`);
      } else if (msg.t === 'worker.remove' && view) {
        if (attached === msg.workerId) detach();
        if (dashboard.home?.worker.id === msg.workerId) dashboard.home = undefined;
        view.workers = view.workers.filter((w) => w.id !== msg.workerId);
      } else if ((msg.t === 'term.snapshot' || msg.t === 'term.data') && attached === msg.workerId) process.stdout.write(msg.data);
      else if (msg.t === 'gh.issues' && view) view.issues = msg.state;
      else if (msg.t === 'gh.pulls' && view) view.pulls = msg.state;
      else if (msg.t === 'communications' && view) view.communications = msg.state;
      else if (msg.t === 'queue' && view) view.queue = msg.state;
      else if (msg.t === 'plan' && view) view.plan = msg.plan;
      else if (msg.t === 'toast') print(`${msg.level}: ${msg.text}`);
      else if (msg.t === 'chat') print(`${msg.name}: ${msg.text}`);
      if (['communications', 'floors', 'worker.remove', 'gh.issues', 'gh.pulls', 'queue', 'plan'].includes(msg.t)) draw();
    });
    function keypress(text: string | undefined, key: readline.Key) {
      if (attached || finished) return;
      if (key.ctrl && key.name === 'c') return done(0);
      if (dashboard.home) {
        const choice = dashboard.home;
        const options = ['all', 'worktree', 'keep'] as const;
        if (key.name === 'escape') { dashboard.home = undefined; dashboard.notice = 'Send home cancelled.'; }
        else if (key.name === 'return') {
          dashboard.home = undefined;
          send({ t: 'worker.kill', workerId: choice.worker.id, ...(choice.worker.worktree && !choice.worker.meeting ? { cleanup: choice.cleanup } : {}) });
          return print(`Sending ${choice.worker.name} home...`);
        } else if (choice.worker.worktree && !choice.worker.meeting) {
          if (text && ['1', '2', '3'].includes(text)) choice.cleanup = options[Number(text) - 1];
          else if (key.name === 'up' || key.name === 'down') choice.cleanup = options[(options.indexOf(choice.cleanup) + (key.name === 'up' ? 2 : 1)) % options.length];
        }
        return draw();
      }
      if (dashboard.command !== undefined) {
        if (key.name === 'escape') dashboard.command = undefined;
        else if (key.name === 'return') {
          const line = dashboard.command; dashboard.command = undefined;
          try { command(line.trim()); } catch (err) { print((err as Error).message); }
        } else if (key.name === 'backspace') dashboard.command = dashboard.command.slice(0, -1);
        else if (key.ctrl && key.name === 'u') dashboard.command = '';
        else if (text && !key.ctrl && !key.meta) dashboard.command += plain(text);
        return draw();
      }
      const all = seats(view), seat = all[dashboard.selected];
      const begin = (value: string) => { dashboard.command = value; draw(); };
      if (key.name === 'escape') { if (dashboard.thread) return panel('messages'); return panel('office'); }
      if (key.name === 'tab') return panel(PANELS[(PANELS.indexOf(dashboard.panel) + (key.shift ? PANELS.length - 1 : 1)) % PANELS.length]);
      if (['up', 'down', 'left', 'right'].includes(key.name ?? '')) {
        const direction = key.name === 'up' || key.name === 'left' ? -1 : 1;
        if (dashboard.panel === 'office') dashboard.selected = Math.max(0, Math.min(all.length - 1, dashboard.selected + direction * (key.name === 'up' || key.name === 'down' ? gridColumns(process.stdout.columns || 80) : 1)));
        else {
          const count = dashboard.panel === 'floors' ? floors.length : dashboard.panel === 'issues' ? view?.issues.items.length : dashboard.panel === 'pulls' ? view?.pulls.items.length : dashboard.panel === 'queue' ? view?.queue.tasks.length : dashboard.panel === 'messages' ? (dashboard.thread ? communicationLines({ ...dashboard, view }, process.stdout.columns || 80).length : view?.communications?.messages.filter((m) => m.kind === 'request').length) : 13;
          dashboard.offset = Math.max(0, Math.min(Math.max(0, (count ?? 0) - 1), dashboard.offset + direction));
        }
        return draw();
      }
      if (key.name === 'return') {
        if (dashboard.panel === 'messages' && !dashboard.thread) {
          dashboard.thread = view?.communications?.messages.filter((m) => m.kind === 'request').reverse()[dashboard.offset]?.id;
          dashboard.offset = 0; return draw();
        }
        if (dashboard.panel === 'floors') {
          const floor = floors[dashboard.offset]; if (floor && !floor.cloning) send({ t: 'floor.go', floor: floor.id });
          return panel('office');
        }
        if (dashboard.panel !== 'office') return;
        if (seat?.worker) return command('attach ' + seat.worker.id);
        if (seat) return begin('hire ');
      }
      if (text === 'q') return done(0);
      if (text === ':') return begin('');
      if (text === 'h') return begin('hire ');
      if (text === 'p' && seat?.worker) return begin('prompt ' + seat.worker.id + ' ');
      if (text === 'r' && seat?.worker) return command('resume ' + seat.worker.id);
      if (text === 'x' && dashboard.panel === 'office' && seat?.worker) return command('home ' + seat.worker.id);
      if (text === 'c') return begin('chat ');
      if (text === 'm') return panel('messages');
      if (text === 'f') return panel('floors');
      if (text === 'i') return panel('issues');
      if (text === 'b') return panel('pulls');
      if (text === 't') return panel('queue');
      if (text === '?') return panel('help');
      if (text === 'n') {
        const waiting = all.filter((s) => s.worker?.status === 'needs_input' || s.worker?.status === 'done');
        const current = waiting.findIndex((s) => s.id === seat?.id);
        if (waiting.length) dashboard.selected = all.indexOf(waiting[(current + 1) % waiting.length]);
        panel('office');
      }
    }
    function command(line: string) {
      const [cmd, key = '', ...tail] = line.split(/\s+/), text = tail.join(' ');
      if (!cmd) return;
      if (teamCommand(line, send, () => panel('teams'))) return;
      if (cmd === 'quit' || cmd === 'exit') return done(0);
      if (cmd === 'help') return panel('help');
      if (cmd === 'messages') { panel('messages'); dashboard.thread = key || undefined; return draw(); }
      if (cmd === 'plans') return panel('plans');
      if (cmd === 'plan-start') {if(!key)throw new Error('Usage: plan-start <JSON-file>');return send({t:'plan-review.start',request:JSON.parse(readFileSync(line.slice(cmd.length).trim(),'utf8'))});}
      if (cmd === 'plan-stop') return send({t:'plan-review.stop'});
      if (cmd === 'plan-retry') return send({t:'plan-review.retry'});
      if (cmd === 'workers') return workers();
      if (cmd === 'floors') return panel('floors');
      if (cmd === 'go') {
        const target = [key, ...tail].join(' ');
        const found = floors.filter((f) => f.id === target || f.name === target);
        if (found.length !== 1) throw new Error('Use a unique floor ID or name from floors');
        return send({ t: 'floor.go', floor: found[0].id });
      }
      if (!view?.floor) throw new Error('Add a project in the browser, then select it with go');
      if (cmd === 'hire') {
        if (!isAgentProvider(key)) throw new Error('Provider: claude, codex, opencode, grok, muse, dsh, pi, cursor, antigravity or custom');
        const all = seats(view);
        const selected = all[dashboard.selected];
        const desk = selected && !selected.worker ? selected : all.find((s) => !s.worker);
        if (!desk) throw new Error('No empty desk on this floor');
        return send({ t: 'worker.spawn', deskId: desk.id, provider: key, prompt: text || undefined });
      }
      if (cmd === 'chat' || cmd === 'enqueue') {
        const body = [key, ...tail].join(' ').trim(); if (!body) throw new Error('Provide some text');
        return send(cmd === 'chat' ? { t: 'chat', text: body } : { t: 'queue.add', prompt: body });
      }
      if (cmd === 'issues' || cmd === 'pulls' || cmd === 'queue') return panel(cmd);
      if (cmd === 'home') {
        if (tail.length && (tail.length !== 2 || tail[0] !== '--cleanup' || !['auto', 'keep', 'worktree', 'all'].includes(tail[1]))) {
          throw new Error('Usage: home <worker> [--cleanup auto|keep|worktree|all]');
        }
        const w = worker(key);
        if (!tail.length) { dashboard.home = { worker: w, cleanup: 'keep' }; return draw(); }
        const cleanup = tail[1];
        send({ t: 'worker.kill', workerId: w.id, ...(cleanup && cleanup !== 'auto' ? { cleanup: cleanup as 'keep' | 'worktree' | 'all' } : {}) });
        return print(`Sending ${w.name} home...`);
      }
      if (['attach', 'prompt', 'resume', 'pr'].includes(cmd)) {
        const w = worker(key);
        if (cmd === 'attach') {
          attached = w.id;
          process.stdout.write('\x1b[0m\x1b[?25h\x1b[2J\x1b[H');
          send({ t: 'worker.attach', workerId: w.id }); resize(); return;
        }
        if (cmd === 'prompt') { if (!text) throw new Error('Provide a prompt'); return send({ t: 'worker.prompt', workerId: w.id, prompt: text }); }
        return send({ t: cmd === 'pr' ? 'worker.pr' : 'worker.resume', workerId: w.id });
      }
      throw new Error('Unknown command. Type help.');
    }
  });
}
