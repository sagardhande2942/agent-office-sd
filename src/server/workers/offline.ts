import { clockWork } from './clock.js';
import type {Worker,WorkerContext} from './types.js';
import type {HeadlessTerminal} from './terminal.js';
export function holdOffline(ctx:Pick<WorkerContext,'events'|'emit'|'persist'>,w:Worker,why:string,term:HeadlessTerminal) {
    const info = w.info;
    clockWork(info, 'exited');
    info.status = 'offline';
    info.exitCode = undefined;
    const hint = info.kind === 'shell' ? ' — press R to restart' : info.sessionId ? ' — press R to resume' : '';
    const msg = `\r\n\x1b[2m[${why}${hint}]\x1b[0m\r\n`;
    term.write(msg);
    if (w.viewers.size) ctx.events.data(info.id, msg, [...w.viewers.keys()]);
    w.screenDirty = true;
    w.unsaved = true;
    ctx.emit(w);
    ctx.persist();
    ctx.events.toast(`${info.name}: ${why}${hint}`, 'warn');
  }
