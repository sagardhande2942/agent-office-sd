import { execFileSync } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';
import { normalizeRepo } from '../../shared/floors.js';
import { validJoinProject, type FloorJoinProject } from '../../shared/floor-join.js';

export const JOIN_HELP = `
  --checkout <dir>     share this existing local project as a floor immediately; saved for reconnects
  --repo <owner/repo>  repository name (otherwise read from the checkout's origin remote)
  --floor <name>       display name for the shared floor
  --same-office        reuse the saved token when this same office moves to a different URL`;

/** Keep the new onboarding options out of the transport's CLI parser. */
export function joinOptions(argv: string[]) {
  const rest: string[] = [];
  let checkout: string | undefined, repo: string | undefined, name: string | undefined;
  let sameOffice = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--same-office') { sameOffice = true; continue; }
    if (!['--checkout', '--repo', '--floor'].includes(a)) { rest.push(a); continue; }
    const value = argv[++i];
    if (!value || value.startsWith('--')) throw Error(`${a} needs a value`);
    if (a === '--checkout') checkout = value;
    else if (a === '--repo') repo = value;
    else name = value;
  }
  if (!checkout && (repo || name)) throw Error('--repo and --floor need --checkout');
  return { rest, checkout, repo, name, sameOffice };
}

export function savedJoinToken(saved: { office: string; token: string } | undefined, office: string, code: string | undefined, sameOffice: boolean) {
  const address = (url: string) => url.replace(/^http/, 'ws').replace(/\/+$/, '');
  return !code && saved && (sameOffice || address(saved.office) === address(office)) ? saved.token : undefined;
}

export function joinProject(checkout: string, repo?: string, name?: string): FloorJoinProject {
  const dir = path.resolve(checkout);
  try { if (!statSync(dir).isDirectory()) throw Error(); }
  catch { throw Error(`No project directory at ${dir}`); }
  let repository = repo;
  if (!repository) {
    try { repository = execFileSync('git', ['-C', dir, 'remote', 'get-url', 'origin'], { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] }).trim(); }
    catch { throw Error('Cannot detect the repository from origin. Add --repo OWNER/REPO.'); }
  }
  const normalized = normalizeRepo(repository);
  if (!normalized) throw Error('Use --repo OWNER/REPO for this project');
  const project = { dir, repo: normalized, ...(name ? { name: name.trim() } : {}) };
  if (!validJoinProject(project)) throw Error('Use a valid project path and a floor name of at most 60 characters');
  return project;
}
