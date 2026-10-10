// Antigravity's workspace hooks. Personal Google credentials and global settings stay untouched.
import { chmodSync, existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { excludeFromGit } from './config.js';
import type { LifecycleReport } from './workers/lifecycle.js';

export const ANTIGRAVITY_EVENTS = ['PreInvocation', 'PostToolUse', 'Stop'] as const;
const record = (v: unknown): v is Record<string, any> => !!v && typeof v === 'object' && !Array.isArray(v);
const id = (v: unknown): v is string => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(v);
export function normalizeAntigravityHook(event: string, payload: unknown): LifecycleReport | undefined {
  if (!(ANTIGRAVITY_EVENTS as readonly string[]).includes(event) || !record(payload) || !id(payload.conversationId)) return;
  if (payload.parentConversationId || payload.subagentId) return;
  const tool = record(payload.toolCall) && typeof payload.toolCall.name === 'string' ? payload.toolCall.name.slice(0, 160) : undefined;
  return { sessionId: payload.conversationId, event: event === 'PreInvocation' ? 'UserPromptSubmit' : event,
    ...(tool ? { tool: tool === 'ask_question' ? 'ask_user_question' : tool === 'ask_permission' ? 'request_user_input' : tool } : {}) };
}
const quote = (v: string) => `'${v.replaceAll("'", "'\"'\"'")}'`;
const originals = new Map<string, string>();
const key = (worker: string) => `agent-office-antigravity-${worker}`;
const hooksPath = (cwd: string) => path.join(cwd, '.agents', 'hooks.json');
function read(file: string): Record<string, unknown> | undefined {
  try { const value: unknown = JSON.parse(readFileSync(file, 'utf8')); return record(value) ? value : undefined; } catch { return; }
}
export function addAntigravityHooks(cwd: string, helper: string, worker: string): boolean {
  if (!id(worker)) return false;
  const file = hooksPath(cwd), existed = existsSync(file);
  const config = existed ? read(file) : {};
  if (!config) return false;
  if (existed && !Object.keys(config).some(k => k.startsWith('agent-office-antigravity-'))) originals.set(file, readFileSync(file, 'utf8'));
  const entry: Record<string, unknown> = {};
  for (const event of ANTIGRAVITY_EVENTS) {
    const handler = { type: 'command', command: [process.execPath, helper, event, worker].map(quote).join(' '), timeout: 5 };
    entry[event] = event.includes('Tool') ? [{ matcher: '*', hooks: [handler] }] : [handler];
  }
  if (Object.hasOwn(config, key(worker))) {
    const previous = config[key(worker)];
    if (!JSON.stringify(previous).includes(helper)) return false;
  }
  config[key(worker)] = entry;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  if (!existed) excludeFromGit(cwd, '.agents/hooks.json');
  return true;
}
export function removeAntigravityHooks(cwd: string, worker: string) {
  const file = hooksPath(cwd), config = read(file);
  if (!config || !JSON.stringify(config[key(worker)] ?? {}).includes('antigravity-hook.cjs')) return;
  delete config[key(worker)];
  const original = originals.get(file);
  if (!Object.keys(config).some(k => k.startsWith('agent-office-antigravity-'))) {
    originals.delete(file);
    if (original !== undefined && JSON.stringify(JSON.parse(original)) === JSON.stringify(config)) { writeFileSync(file, original); return; }
  }
  if (!Object.keys(config).length) unlinkSync(file);
  else writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
}
export function antigravityArgs(args: string[], model?: string, effort?: string, resume?: string): string[] {
  const valued = ['--model', '--effort', '--conversation', '--prompt', '--print', '-p', '--output-format', '--input-format', '--prompt-interactive', '-i', '--project', '--new-project', '--mode'];
  const flags = ['--continue', '-c', '--dangerously-skip-permissions'];
  const clean: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--') break;
    if (flags.some(f => args[i] === f || args[i].startsWith(f + '='))) continue;
    if (valued.includes(args[i])) { if (args[i + 1] && !args[i + 1].startsWith('-')) i++; continue; }
    if (valued.some(f => args[i].startsWith(f + '='))) continue;
    clean.push(args[i]);
  }
  if (resume) clean.push('--conversation', resume);
  if (model) clean.push('--model', model);
  if (effort) clean.push('--effort', effort);
  return clean;
}
export function writeAntigravityHook(dataDir: string): string {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const file = path.join(dataDir, 'antigravity-hook.cjs');
  writeFileSync(file, HOOK_SOURCE, { mode: 0o600 }); chmodSync(file, 0o600); return file;
}
// Observe activity after tools complete; leave permission gating to the CLI.
export const HOOK_SOURCE = String.raw`
const event = process.argv[2], worker = process.argv[3];
let bytes = 0, chunks = [], overflow = false;
process.stdin.on('data', b => { bytes += b.length; if (bytes > 1048576) { overflow = true; chunks = []; } else if (!overflow) chunks.push(b); });
process.stdin.on('end', async () => {
  try {
    if (overflow || process.env.AGENT_OFFICE_WORKER_ID !== worker) return;
    const p = JSON.parse(Buffer.concat(chunks).toString());
    if (!p || typeof p !== 'object' || p.parentConversationId || p.subagentId) return;
    const body = { conversationId: p.conversationId };
    if (p.toolCall && typeof p.toolCall.name === 'string') body.toolCall = { name: p.toolCall.name.slice(0,160) };
    const url = new URL('/hooks/antigravity', process.env.AGENT_OFFICE_HOOK_URL);
    url.searchParams.set('worker', worker); url.searchParams.set('event', event);
    await fetch(url, { method: 'POST', headers: { authorization: 'Bearer ' + process.env.AGENT_OFFICE_HOOK_TOKEN, 'content-type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(2000) });
  } catch {} finally { process.stdout.write('{}'); }
});
`;
