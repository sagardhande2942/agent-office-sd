import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import type { BriefAiProvider } from '../../shared/task-brief-ai.js';

export interface DraftProcessOptions { cwd: string; env: Record<string, string>; input: string; signal: AbortSignal; timeout?: number; maxBytes?: number; }
export type DraftRunner = (file: string, args: string[], options: DraftProcessOptions) => Promise<string>;

/** Run standard npm launchers through their native or JS entry point on Windows, without a shell. */
export function draftLaunch(file: string, provider: BriefAiProvider, platform = process.platform): { file: string; prefix: string[] } {
  if (platform !== 'win32' || !/\.(cmd|bat)$/i.test(file)) return { file, prefix: [] };
  const entry = provider === 'claude' ? ['@anthropic-ai', 'claude-code', 'cli.js'] : ['@openai', 'codex', 'bin', 'codex.js'];
  const roots = [path.join(path.dirname(file), 'node_modules'), path.join(path.dirname(file), '..')];
  const native = provider === 'claude' ? roots.map(root => path.join(root, '@anthropic-ai', 'claude-code', 'bin', 'claude.exe')).find(p => existsSync(p)) : undefined;
  if (native) return { file: native, prefix: [] };
  const candidates = roots.map(root => path.join(root, ...entry));
  const script = candidates.find(p => existsSync(p));
  if (!script) throw new Error(`Install the standard ${provider} CLI or its native executable on the office server; this launcher is not supported.`);
  return { file: process.execPath, prefix: [script] };
}

/** Bounded output and lifetime; abort kills the process group rather than leaving a draft running. */
export const runDraftProcess: DraftRunner = (file, args, options) => new Promise((resolve, reject) => {
  if (options.signal.aborted) return reject(new Error('Draft cancelled.'));
  const child = spawn(file, args, { cwd: options.cwd, env: options.env, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true, detached: process.platform !== 'win32' });
  let output = '', bytes = 0, failure: Error | undefined;
  const stop = (message: string) => {
    if (failure) return;
    failure = new Error(message);
    if (child.pid) {
      if (process.platform === 'win32') spawn('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
      else { try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } }
    }
  };
  const abort = () => stop('Draft cancelled.');
  options.signal.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(() => stop('AI drafting timed out. Try again or continue manually.'), options.timeout ?? 90_000);
  child.stdout.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => {
    bytes += Buffer.byteLength(chunk);
    if (bytes > (options.maxBytes ?? 256_000)) stop('AI returned too much output. Continue manually or try a shorter request.');
    else output += chunk;
  });
  // Drain stderr, but never return CLI diagnostics that may contain credentials or request text.
  child.stderr.resume();
  child.stdin.on('error', () => {});
  child.on('error', () => { failure ??= new Error('Could not start the AI CLI. Check its installation on the office server.'); });
  child.on('close', code => {
    clearTimeout(timer); options.signal.removeEventListener('abort', abort);
    if (failure) reject(failure);
    else if (code !== 0) reject(new Error('AI drafting failed. Check the CLI sign-in and version on the office server, or continue manually.'));
    else resolve(output);
  });
  child.stdin.end(options.input);
});
