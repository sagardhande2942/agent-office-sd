import { execFileSync } from 'node:child_process';

const standaloneByCommand = new Map<string, boolean>();

/** V2's shared service retains the environment of whoever started it, including model config. */
export function openCodeNeedsStandalone(command?: string): boolean {
  if (!command) return false;
  const cached = standaloneByCommand.get(command);
  if (cached !== undefined) return cached;
  try {
    const version = execFileSync(command, ['--version'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const major = /^(?:opencode\s+)?v?(\d+)\./i.exec(version)?.[1];
    const standalone = major !== undefined && Number(major) >= 2;
    standaloneByCommand.set(command, standalone);
    return standalone;
  } catch {
    // Let the normal launch surface missing commands; do not invent a flag for an unknown CLI.
    return false;
  }
}
