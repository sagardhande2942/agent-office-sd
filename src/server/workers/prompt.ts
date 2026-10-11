import type { BossGuard } from '../../shared/boss.js';
import { validBossGuard, validBossPrompt } from '../../shared/boss.js';
import { teamPromptError } from '../master-workers/role.js';
import type { WorkerContext } from './types.js';
import { featurePrompt } from './features.js';
import { truncate } from './util.js';

/** Shared terminal / ACP prompt delivery; extensions never decorate a permission answer. */
export function promptWorker(ctx: WorkerContext, id: string, text: string, by?: string, guard?: BossGuard): string | undefined {
  const w = ctx.workers.get(id);
  if (!w) return 'No such worker';
  const managed = teamPromptError(w.info, by); if (managed) return managed;
  if (guard !== undefined && (!validBossGuard(w.info, guard) || !validBossPrompt(text))) return 'Worker changed or is unavailable for a boss prompt';
  const clean = text.replace(/\r\n?/g, '\n').trim();
  if (!clean) return 'Empty prompt';
  if (!w.dsh && !w.pty) return 'Worker is not running';
  const delivered = w.info.kind === 'agent' && w.info.status !== 'needs_input' ? featurePrompt(ctx.events, w.info, clean) ?? clean : clean;
  if (w.dsh) w.dsh.prompt(delivered);
  else {
    w.pty!.write(`\x1b[200~${delivered}\x1b[201~`);
    setTimeout(() => { if (guard === undefined || validBossGuard(w.info, guard)) w.pty?.write('\r'); }, 120);
  }
  w.info.activity = truncate(clean, 80);
  ctx.notePrompt(w, clean);
  if (by) w.info.lastInput = { by, at: Date.now() };
  ctx.emit(w);
}
