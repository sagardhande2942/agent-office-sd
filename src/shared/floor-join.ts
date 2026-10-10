import { normalizeRepo } from './floors.js';

/** Optional extension to the existing authenticated floor-host handshake. */
export interface FloorJoinProject { dir: string; repo: string; name?: string }
export interface FloorJoinHello { project?: FloorJoinProject }

export function validJoinProject(value: unknown): value is FloorJoinProject {
  if (!value || typeof value !== 'object') return false;
  const p = value as Partial<FloorJoinProject>;
  return typeof p.dir === 'string' && p.dir.length <= 4096 && !/[\u0000-\u001f]/.test(p.dir)
    && /^(?:\/|[A-Za-z]:[\\/]|\\\\)/.test(p.dir)
    && typeof p.repo === 'string' && normalizeRepo(p.repo) === p.repo
    && (p.name === undefined || (typeof p.name === 'string' && p.name.trim().length > 0 && p.name.length <= 60 && !/[\p{C}]/u.test(p.name)));
}

export function floorJoinCommand(input: { office: string; code: string; checkout: string; repo?: string; name?: string }, shell: 'powershell' | 'bash') {
  const quote = (s: string) => shell === 'powershell' ? `'${s.replace(/'/g, "''")}'` : `'${s.replace(/'/g, "'\\''")}'`;
  const args = ['npm start -- floor-host', '--office', quote(input.office), '--code', quote(input.code), '--checkout', quote(input.checkout)];
  if (input.repo?.trim()) args.push('--repo', quote(input.repo.trim()));
  if (input.name?.trim()) args.push('--name', quote(input.name.trim()));
  return args.join(' ');
}
