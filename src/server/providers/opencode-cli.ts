import { execFileSync } from 'node:child_process';
import { WIN } from '../workers/process.js';

const standaloneByCommand = new Map<string, boolean>();

/** V2's shared service retains the environment of whoever started it, including model config. */
export function openCodeNeedsStandalone(command?: string): boolean {
  if (!command) return false;
  const cached = standaloneByCommand.get(command);
  if (cached !== undefined) return cached;
  try {
    // Windows runs an npm-installed `opencode` as a .cmd shim, which CreateProcess cannot start
    // without cmd.exe. Resolving to the shim still leaves it on PATH for the shell to run.
    const version = execFileSync(command, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'], shell: WIN }).trim();
    const major = /^(?:opencode\s+)?v?(\d+)\./i.exec(version)?.[1];
    const standalone = major !== undefined && Number(major) >= 2;
    standaloneByCommand.set(command, standalone);
    return standalone;
  } catch {
    // Let the normal launch surface missing commands; do not invent a flag for an unknown CLI.
    return false;
  }
}
