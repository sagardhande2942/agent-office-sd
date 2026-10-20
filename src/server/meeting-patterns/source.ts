import path from 'node:path';
import { readFileSync, statSync, realpathSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { atomicWrite } from '../knowledge/store.js';

/** Trusted reviewed code only. Never read a worker-selected path outside its meeting worktree. */
export function strategySource(cwd: string, output: any, archivedFile?: string): string {
  let bytes: Buffer;
  if (typeof output.details?.source === 'string') bytes = Buffer.from(output.details.source, 'utf8');
  else {
    const input = archivedFile ?? (typeof output.details?.source_path === 'string' ? path.resolve(cwd, output.details.source_path) : undefined);
    if (!input) throw Error('Build ready needs source_path or inline source');
    const file = realpathSync(input);
    if (!file.startsWith(realpathSync(cwd) + path.sep) || statSync(file).size > 200000) throw Error('Strategy source must stay within its meeting worktree/archive and size limit');
    bytes = readFileSync(file);
  }
  if (bytes.length > 200000 || createHash('sha256').update(bytes).digest('hex') !== output.details?.source_digest) throw Error('Strategy source digest mismatch');
  return bytes.toString('utf8');
}
export function archiveStrategySource(cwd: string, outputPath: string, archive: string) {
  const output = JSON.parse(readFileSync(path.join(cwd, outputPath), 'utf8'));
  if (output.pattern === 'research.strategy-build' && output.outcome === 'ready')
    atomicWrite(path.join(archive, 'strategy-source.py'), strategySource(cwd, output));
}
