import { gh, bb } from './forge.js';
import { normalizeRepo } from '../shared/floors.js';
import type { ForgeKind, RepoChoice } from '../shared/protocol.js';
const MAX_REPOS = 1000;
interface Found {
  repo: string;
  forge: ForgeKind;
  /** The name the forge's own CLI answered to, which is the one it can clone from. */
  asked?: string;
}
export async function askBb(repo: string, cwd: string): Promise<Found | undefined> {
  const slug = repo.split('/').pop() ?? repo;
  for (const asked of [repo, slug]) {
    try {
      const out = await bb(['repo', 'view', asked, '--json', 'full_name'], cwd, 30_000);
      const full = normalizeRepo((JSON.parse(out || '{}') as { full_name?: string }).full_name);
      if (full) return { repo: full, forge: 'bitbucket', asked };
    } catch {
      // Not that one, or not under that name: try the next way of saying it.
    }
  }
  return undefined;
}

/** Clones `repo` to `dest`, or checks that what's already there is that repository. `asked` is the
 * name the forge answered to, which for Bitbucket is the form its CLI can clone from. */
export async function listRepos(cwd: string): Promise<RepoChoice[]> {
  const [github, bitbucket] = await Promise.allSettled([githubRepos(cwd), bitbucketRepos(cwd)]);
  if (github.status === 'rejected' && bitbucket.status === 'rejected') throw github.reason;
  const repos = [...(github.status === 'fulfilled' ? github.value : []), ...(bitbucket.status === 'fulfilled' ? bitbucket.value : [])];
  const seen = new Set<string>();
  return repos
    .filter((r) => (seen.has(r.name.toLowerCase()) ? false : seen.add(r.name.toLowerCase())))
    .sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''))
    .slice(0, MAX_REPOS);
}

async function githubRepos(cwd: string): Promise<RepoChoice[]> {
  const out = await gh(
    [
      'api',
      '--paginate',
      'user/repos?per_page=100&sort=pushed&affiliation=owner,collaborator,organization_member',
      '--jq',
      '.[] | {name: .full_name, description: (.description // ""), private: .private, pushedAt: .pushed_at}',
    ],
    cwd,
    90_000,
  );
  const repos: RepoChoice[] = [];
  for (const line of out.split('\n')) {
    if (!line.trim()) continue;
    try {
      const r = JSON.parse(line) as { name?: unknown; description?: unknown; private?: unknown; pushedAt?: unknown };
      const name = normalizeRepo(r.name);
      if (!name) continue;
      repos.push({
        name,
        forge: 'github',
        description: typeof r.description === 'string' && r.description ? r.description.slice(0, 200) : undefined,
        private: r.private === true,
        pushedAt: typeof r.pushedAt === 'string' ? r.pushedAt : undefined,
      });
    } catch {
      // not a line of ours
    }
    if (repos.length >= MAX_REPOS) break;
  }
  return repos;
}

/**
 * The repositories in every Bitbucket workspace this login belongs to.
 *
 * bb works out a workspace for itself — `BB_WORKSPACE`, or the default its sign-in recorded — and
 * that is the only way to reach a *personal* workspace, whose slug is often not the username: named
 * outright, bb answers `No workspace with identifier 'tradai'` and `repo view tradi/discovery` says
 * the repository is not found, while `discovery` alone works. So the workspace bb has for itself is
 * listed without one, and every other workspace is asked for by name, with any that won't answer
 * left out rather than failing the whole list.
 */
async function bitbucketRepos(cwd: string): Promise<RepoChoice[]> {
  const repos: RepoChoice[] = [];
  // A workspace list that can't be read is not a reason to show nothing: the default one still can.
  const slugs = await Promise.allSettled([bbWorkspaceSlugs(cwd)]).then(([s]) => (s.status === 'fulfilled' ? s.value : []));
  // Asking for exactly the fields the elevator shows, rather than each repository in full, is a
  // fraction of the JSON: four fields against a links-and-permissions object apiece.
  const pages = await Promise.allSettled([undefined, ...slugs].map((s) => bbRepoPage(s, cwd)));
  for (const page of pages) {
    if (page.status !== 'fulfilled') continue;
    for (const r of page.value) {
      repos.push(r);
      if (repos.length >= MAX_REPOS) break;
    }
    if (repos.length >= MAX_REPOS) break;
  }
  return repos;
}

/** The slugs of the workspaces this login belongs to; the default one among them, if bb names it. */
async function bbWorkspaceSlugs(cwd: string): Promise<string[]> {
  const listed = await bb(['workspace', 'list', '--json'], cwd, 60_000);
  // Each entry is a workspace_access wrapper with the workspace itself under `workspace`, so the
  // slug is one level in — reading it off the entry finds nothing and the list comes back empty.
  return ((JSON.parse(listed || '{}') as { workspaces?: any[] }).workspaces ?? [])
    .map((w) => String(w?.workspace?.slug ?? w?.slug ?? '').trim())
    .filter(Boolean);
}

/** One page of `bb repo list`: `workspace` is undefined for the workspace bb has for itself. */
async function bbRepoPage(workspace: string | undefined, cwd: string): Promise<RepoChoice[]> {
  const out = await bb(['repo', 'list', ...(workspace ? ['--workspace', workspace] : []), '--all', '--json', 'full_name,description,is_private,updated_on'], cwd, 90_000);
  // Naming the fields drops the envelope and answers with a flat array; a bare `--json` keeps it.
  const parsed = JSON.parse(out || '[]') as any[] | { repositories?: any[] };
  const rows = Array.isArray(parsed) ? parsed : (parsed.repositories ?? []);
  const repos: RepoChoice[] = [];
  for (const r of rows) {
    const name = normalizeRepo(r?.full_name);
    if (!name) continue;
    repos.push({
      name,
      forge: 'bitbucket',
      description: typeof r?.description === 'string' && r.description ? r.description.slice(0, 200) : undefined,
      private: r?.is_private === true,
      pushedAt: typeof r?.updated_on === 'string' ? r.updated_on : undefined,
    });
  }
  return repos;
}
