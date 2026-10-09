import { CLAUDE_VARS, GITHUB_VARS, BITBUCKET_VARS, FLOW_MS, LOOK_GAP_MS, LOOK_TIMEOUT_MS, CLAUDE_TOKEN, API_KEY, GITHUB_TOKEN, BITBUCKET_TOKEN, ACCOUNT_ID, BITBUCKET_USER, HELP_WHERE, Saved, Flow, Live, ForgeAs } from './signin-types.js';
export type { ForgeAs } from './signin-types.js';
import * as accountConfig from './signin-config.js';
import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import * as pty from '@lydell/node-pty';
import type { ForgeKind, SignInKind, SignInState, SignInsState } from '../shared/protocol.js';
export class SignIns {
  private homes: string;
  private live = new Map<string, Live>();
  constructor(
    dataDir: string,
    /** The `claude`, `gh` and `bb` binaries, or null when they aren't installed. */
    private claude: string | null,
    private gh: string | null,
    private bb: string | null,
    /** The office's own environment, which everyone's is built on. */
    private base: () => Record<string, string>,
    /** Whether the account may use the office's own sign-ins (admins). */
    private mayUseOffice: (accountId: string) => boolean,
    private onChange: (accountId: string) => void,
  ) {
    this.homes = path.join(dataDir, 'homes');
  }
  state(id: string): SignInsState {
    const s = this.load(id);
    const l = this.get(id);
    return {
      claude: { ...l.claude, how: this.how(id, s, 'claude') },
      github: { ...l.github, how: this.how(id, s, 'github') },
      bitbucket: { ...l.bitbucket, how: this.how(id, s, 'bitbucket') },
      office: this.mayUseOffice(id),
    };
  }
  /** Whether `id` has a Claude sign-in its workers can start on, as far as the last look knows. */
  claudeReady(id: string): boolean {
    const s = this.load(id);
    return this.how(id, s, 'claude') !== 'login' || !!s.seen?.claude;
  }
  githubReady(id: string): boolean {
    const s = this.load(id);
    return this.how(id, s, 'github') === 'office' || !!s.seen?.github;
  }
  bitbucketReady(id: string): boolean {
    const s = this.load(id);
    return this.how(id, s, 'bitbucket') === 'office' || !!s.seen?.bitbucket;
  }
  /** Whether `id` is signed in to `kind` far enough for the office to act on it for them. */
  ready(id: string, kind: SignInKind): boolean {
    return kind === 'claude' ? this.claudeReady(id) : kind === 'github' ? this.githubReady(id) : this.bitbucketReady(id);
  }
  /** What to tell someone who needs `which` signed in first. */
  why(which: SignInKind): string {
    if (which === 'claude') return `Sign in to Claude first (${HELP_WHERE}): your workers run on your own Claude plan`;
    const forge = which === 'github' ? 'GitHub' : 'Bitbucket';
    return `Sign in to ${forge} first (${HELP_WHERE}): the office acts on ${forge} as you`;
  }
  /**
   * Changes whenever what `id`'s Claude signs in with changes (to read its plan's limits afresh).
   * Undefined when it's the office's own.
   */
  claudeKey(id: string): string | undefined {
    const s = this.load(id);
    const how = this.how(id, s, 'claude');
    if (how === 'office') return undefined;
    return `${how}:${s.claude?.use === 'token' ? s.claude.token.slice(-12) : ''}:${s.seen?.claude ?? ''}`;
  }
  /** The login `id` acts as on `kind` (for "you" on comments); undefined when it's the office's own or none. */
  forgeLogin(id: string, kind: ForgeKind): string | undefined {
    const s = this.load(id);
    return this.how(id, s, kind) === 'login' ? s.seen?.[kind]?.replace(/^@/, '') : undefined;
  }
  /** The GitHub login `id` acts as (for "you" on comments); undefined when it's the office's own or none. */
  githubLogin(id: string): string | undefined {
    return this.forgeLogin(id, 'github');
  }

  /** The Bitbucket username `id` acts as; undefined when it's the office's own or none. */
  bitbucketLogin(id: string): string | undefined {
    return this.forgeLogin(id, 'bitbucket');
  }

  /**
   * Puts `id`'s own sign-ins in place of the office's in `env` (changed in place, and returned).
   * `dirs` are where a worker is about to start, to carry over the office's folder trust.
   */
  apply(id: string, env: Record<string, string>, dirs: string[] = [], only?: SignInKind): Record<string, string> {
    const s = this.load(id);
    const home = this.prepare(id);
    if (only !== 'github' && only !== 'bitbucket' && this.how(id, s, 'claude') !== 'office') {
      for (const k of CLAUDE_VARS) delete env[k];
      env.CLAUDE_CONFIG_DIR = path.join(home, 'claude');
      if (s.claude?.use === 'token') env[API_KEY.test(s.claude.token) ? 'ANTHROPIC_API_KEY' : 'CLAUDE_CODE_OAUTH_TOKEN'] = s.claude.token;
      if (dirs.length) this.trust(env.CLAUDE_CONFIG_DIR, dirs);
    }
    if (only !== 'claude' && only !== 'bitbucket' && this.how(id, s, 'github') !== 'office') {
      for (const k of GITHUB_VARS) delete env[k];
      env.GH_CONFIG_DIR = path.join(home, 'gh');
      env.GIT_CONFIG_GLOBAL = path.join(home, 'gitconfig');
    }
    if (only !== 'claude' && only !== 'github' && this.how(id, s, 'bitbucket') !== 'office') {
      for (const k of BITBUCKET_VARS) delete env[k];
      // See bitbucketEnv: bb keeps its config under the home folder, not under a directory of its own.
      const home2 = this.bitbucketHome(id);
      env.HOME = env.USERPROFILE = env.XDG_CONFIG_HOME = home2;
    }
    return env;
  }

  /**
   * How the office runs the forge's CLI for `id`: as them (ForgeAs), as itself (undefined, an
   * admin's choice), or a reason it can't.
   */
  forgeAs(id: string, kind: ForgeKind): ForgeAs | undefined | string {
    const s = this.load(id);
    if (this.how(id, s, kind) === 'office') return undefined;
    const who = s.seen?.[kind];
    if (!who) return this.why(kind);
    return { key: id, kind, name: who.replace(/^@/, ''), env: this.apply(id, this.base(), [], kind) };
  }

  /** How the office runs gh for `id`; see forgeAs. */
  ghAs(id: string): ForgeAs | undefined | string {
    return this.forgeAs(id, 'github');
  }

  /** How the office runs bb for `id`; see forgeAs. */
  bbAs(id: string): ForgeAs | undefined | string {
    return this.forgeAs(id, 'bitbucket');
  }

  /** Looks at who `id` is signed in as, now if `force`, else unless it just did. */
  look(id: string, force = false): Promise<void> {
    const l = this.get(id);
    if (l.looking) return l.looking;
    if (!force && Date.now() - l.lookedAt < LOOK_GAP_MS) return Promise.resolve();
    l.looking = Promise.all([this.lookClaude(id), this.lookGithub(id), this.lookBitbucket(id)]).then(() => {
      l.lookedAt = Date.now();
      l.looking = undefined;
      this.onChange(id);
    });
    return l.looking;
  }

  /** Starts signing `id` in from the office. The page to open comes through state(). Returns why it can't. */
  start(id: string, which: SignInKind): string | undefined {
    if (which === 'claude') return this.startClaude(id);
    // bb's OAuth needs a browser that can reach a loopback server on the office machine, which is
    // where the person already is: so signing in to Bitbucket is pasting an API token instead.
    if (which === 'bitbucket') return "Bitbucket has no sign-in page this office can hand out — paste an Atlassian API token instead";
    return this.startGithub(id);
  }

  /** The code Claude's sign-in page showed, typed in where `claude auth login` waits for it. */
  code(id: string, code: string): string | undefined {
    const l = this.get(id);
    const flow = l.flows.claude;
    if (!flow?.write) return 'Start signing in to Claude first';
    const clean = code.trim();
    if (!/^[A-Za-z0-9#_.~-]{8,2048}$/.test(clean)) return "That doesn't look like the code from Claude's sign-in page";
    flow.write(`${clean}\r`);
    l.claude = { ...l.claude, pending: { ...l.claude.pending, sent: true }, error: undefined };
    this.onChange(id);
    return undefined;
  }

  cancel(id: string, which: SignInKind) {
    this.stop(id, which);
    void this.look(id, true);
  }

  /** A pasted token: from `claude setup-token` (or an API key), or a forge's own. Resolves to why it didn't take. */
  async token(id: string, which: SignInKind, raw: string): Promise<string | undefined> {
    const token = raw.trim();
    this.stop(id, which);
    if (which === 'claude') {
      if (!CLAUDE_TOKEN.test(token)) return "That isn't a token from `claude setup-token` (sk-ant-oat01-…) or an Anthropic API key (sk-ant-api03-…)";
      const s = this.load(id);
      s.claude = { use: 'token', token };
      this.save(id, s);
      // Claude asks once before it uses an API key from the environment; this one is theirs, so it's approved.
      if (API_KEY.test(token)) {
        this.seed(path.join(this.prepare(id), 'claude'), (c) => {
          c.customApiKeyResponses ??= { approved: [], rejected: [] };
          const tail = token.slice(-20);
          if (!c.customApiKeyResponses.approved.includes(tail)) c.customApiKeyResponses.approved.push(tail);
        });
      }
      await this.look(id, true);
      return undefined;
    }
    if (which === 'bitbucket') return this.bitbucketToken(id, token);
    if (!this.gh) return "The GitHub CLI (gh) isn't installed on the office's machine";
    if (!GITHUB_TOKEN.test(token)) return "That doesn't look like a GitHub token (ghp_…, github_pat_…)";
    const s = this.load(id);
    delete s.github;
    this.save(id, s);
    const r = await run(this.gh, ['auth', 'login', '--hostname', 'github.com', '--with-token', '--insecure-storage'], this.githubEnv(id), `${token}\n`);
    await this.look(id, true);
    return r.code === 0 ? undefined : `GitHub didn't take that token: ${r.last || 'gh auth login failed'}`;
  }

  /**
   * Signs `id` in to Bitbucket with an Atlassian API token. bb takes the token on stdin and the
   * username beside it, and only ever keeps credentials in its own config file, which lives under
   * the home folder (see bitbucketEnv).
   */
  private async bitbucketToken(id: string, token: string): Promise<string | undefined> {
    if (!this.bb) return "The Bitbucket CLI (bb) isn't installed on the office's machine";
    const [username, ...rest] = token.split(/\s+/);
    if (!BITBUCKET_USER.test(username ?? '')) return "That doesn't look like a Bitbucket username and token — type your username, a space, then the token (ATBB…)";
    const secret = rest.join('').trim();
    if (!BITBUCKET_TOKEN.test(secret)) return 'That doesn’t look like an Atlassian API token (ATBB…)';
    const s = this.load(id);
    delete s.bitbucket;
    this.save(id, s);
    const r = await run(this.bb, ['auth', 'login', '--username', username, '--with-token'], this.bitbucketEnv(id), `${secret}\n`);
    await this.look(id, true);
    if (r.code === 0) return undefined;
    return `Bitbucket didn't take that token: ${r.last || 'bb auth login failed'}`;
  }

  /** Uses the office machine's own sign-in (admins only). */
  useOffice(id: string, which: SignInKind): string | undefined {
    if (!this.mayUseOffice(id)) return "Only admins can use the office's own sign-ins";
    this.stop(id, which);
    const s = this.load(id);
    s[which] = { use: 'office' };
    this.save(id, s);
    void this.look(id, true);
    return undefined;
  }

  async signOut(id: string, which: SignInKind) {
    this.stop(id, which);
    const s = this.load(id);
    const how = this.how(id, s, which);
    if (how === 'login') await this.logout(id, which);
    delete s[which];
    if (s.seen) delete s.seen[which];
    this.save(id, s);
    if (which === 'github') this.writeGitConfig(id);
    await this.look(id, true);
  }

  /** An account is gone: sign its logins out and delete its folder. */
  forget(id: string) {
    if (!ACCOUNT_ID.test(id)) return;
    this.stop(id, 'claude');
    this.stop(id, 'github');
    this.stop(id, 'bitbucket');
    this.live.delete(id);
    const home = path.join(this.homes, id);
    if (!existsSync(home)) return;
    // On a Mac, Claude keeps the login in the keychain, not the folder: sign out so it goes too.
    void this.logout(id, 'claude').finally(() => {
      try {
        rmSync(home, { recursive: true, force: true });
      } catch (err) {
        console.error(`agent-office: couldn't delete ${home}: ${(err as Error).message}`);
      }
    });
  }

  /** Deletes the folders of accounts that no longer exist (revoked from the terminal meanwhile). */
  prune(accounts: Set<string>) {
    let names: string[];
    try {
      names = readdirSync(this.homes);
    } catch {
      return;
    }
    for (const n of names) if (ACCOUNT_ID.test(n) && !accounts.has(n)) this.forget(n);
  }

  shutdown() {
    for (const [id] of this.live) {
      this.stop(id, 'claude');
      this.stop(id, 'github');
      this.stop(id, 'bitbucket');
    }
  }

  // ---------------------------------------------------------------------------

  /** How `which` signs `id` in. A demoted admin's 'office' no longer counts: back to their own. */
  private how(id: string, s: Saved, which: SignInKind): SignInState['how'] {
    const use = s[which]?.use;
    if (use === 'office') return this.mayUseOffice(id) ? 'office' : 'login';
    return use === 'token' ? 'token' : 'login';
  }

  private get(id: string): Live {
    let l = this.live.get(id);
    if (!l) {
      const seen = this.load(id).seen ?? {};
      l = {
        claude: seen.claude ? { status: 'ok', who: seen.claude } : { status: 'none' },
        github: seen.github ? { status: 'ok', who: seen.github } : { status: 'none' },
        bitbucket: seen.bitbucket ? { status: 'ok', who: seen.bitbucket } : { status: 'none' },
        flows: {},
        lookedAt: 0,
      };
      this.live.set(id, l);
    }
    return l;
  }

  private home(id: string): string {
    if (!ACCOUNT_ID.test(id)) throw new Error(`not an account id: ${id}`);
    return path.join(this.homes, id);
  }

  /** The account's folder, made on first use. */
  private prepare(id: string): string {
    const home = this.home(id);
    if (!existsSync(path.join(home, 'gitconfig'))) {
      for (const d of [this.homes, home, path.join(home, 'claude'), path.join(home, 'gh'), path.join(home, 'bb')]) mkdirSync(d, { recursive: true, mode: 0o700 });
      this.seed(path.join(home, 'claude'));
      this.writeGitConfig(id);
    }
    return home;
  }

  private load(id: string): Saved {
    try {
      const s = JSON.parse(readFileSync(path.join(this.home(id), 'signins.json'), 'utf8')) as Saved;
      return s && typeof s === 'object' ? s : {};
    } catch {
      return {};
    }
  }

  private save(id: string, s: Saved) {
    this.prepare(id);
    try {
      writeFileSync(path.join(this.home(id), 'signins.json'), JSON.stringify(s, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error(`agent-office: couldn't save ${id}'s sign-ins: ${(err as Error).message}`);
    }
  }

  private stop(id: string, which: SignInKind) {
    const l = this.live.get(id);
    const flow = l?.flows[which];
    if (!l || !flow) return;
    delete l.flows[which];
    flow.stop();
    l[which] = { ...l[which], status: l[which].who ? 'ok' : 'none', pending: undefined };
  }

  /** The environment for `claude` run as `id`'s own login (never a pasted token or the office's). */
  private claudeEnv(id: string): Record<string, string> {
    const env = this.base();
    for (const k of CLAUDE_VARS) delete env[k];
    env.CLAUDE_CONFIG_DIR = path.join(this.prepare(id), 'claude');
    return env;
  }

  private githubEnv(id: string): Record<string, string> {
    const env = this.base();
    for (const k of GITHUB_VARS) delete env[k];
    const home = this.prepare(id);
    env.GH_CONFIG_DIR = path.join(home, 'gh');
    env.GIT_CONFIG_GLOBAL = path.join(home, 'gitconfig');
    return env;
  }

  /**
   * The environment bb runs in as `id`'s own sign-in.
   *
   * bb has no configuration directory variable and no environment credentials: it keeps its
   * username and token in one file under the home folder (bb/config.json on macOS and Linux,
   * %APPDATA%\bb\config.json on Windows), and reads nothing but its own file. So the account's
   * sign-in is kept by pointing bb at a home folder of its own, which is the only lever it leaves.
   * Only bb's own commands get it, never git, so a worker's pushes still use the office's SSH keys.
   */
  private bitbucketEnv(id: string): Record<string, string> {
    const env = this.base();
    for (const k of BITBUCKET_VARS) delete env[k];
    const home = this.bitbucketHome(id);
    env.HOME = env.USERPROFILE = env.XDG_CONFIG_HOME = home;
    return env;
  }

  /** The folder bb keeps an account's sign-in in: a home folder, made on first use. */
  private bitbucketHome(id: string): string {
    const dir = path.join(this.prepare(id), 'bb');
    // The place bb looks on macOS and Linux, and the one it would make for itself anyway.
    mkdirSync(path.join(dir, '.config', 'bb'), { recursive: true, mode: 0o700 });
    return dir;
  }

  private startClaude(id: string): string | undefined {
    if (!this.claude) return "Claude Code isn't installed where the office can run it — paste a token from `claude setup-token` instead";
    this.stop(id, 'claude');
    const l = this.get(id);
    // BROWSER=true: Claude "opens" the page with the `true` command and just prints it, for the browser to show.
    const env = { ...this.claudeEnv(id), BROWSER: 'true', TERM: 'xterm-256color' };
    let p: pty.IPty;
    try {
      // Wide, so the link comes out on one line.
      p = pty.spawn(this.claude, ['auth', 'login', '--claudeai'], { name: 'xterm-256color', cols: 4000, rows: 40, cwd: this.home(id), env });
    } catch (err) {
      return `Couldn't start Claude Code's sign-in: ${(err as Error).message}`;
    }
    let out = '';
    /** Where the output after the code was sent starts, to tell a wrong code apart from the first ask. */
    let sentAt = -1;
    const flow: Flow = {
      stop: () => {
        try {
          p.kill();
        } catch {
          // already gone
        }
      },
      write: (data) => {
        sentAt = out.length;
        p.write(data);
      },
    };
    const timer = setTimeout(flow.stop, FLOW_MS);
    p.onData((d) => {
      out = (out + d).slice(-50_000);
      if (l.flows.claude !== flow) return;
      const text = plain(out);
      if (!l.claude.pending?.url) {
        const url = /https:\/\/\S*oauth\/authorize\?\S+/.exec(text)?.[0];
        if (url) {
          l.claude = { status: 'busy', pending: { url } };
          this.onChange(id);
        }
      } else if (sentAt >= 0 && /error|invalid|expired|failed/i.test(plain(out.slice(sentAt)))) {
        // Still running after complaining: the code didn't take, and it waits for another.
        const said = lastWords(out.slice(sentAt));
        sentAt = -1;
        l.claude = { status: 'busy', pending: { url: l.claude.pending.url }, error: said || "That code didn't work — copy it again, or start over" };
        this.onChange(id);
      }
    });
    p.onExit(({ exitCode }) => {
      clearTimeout(timer);
      if (l.flows.claude !== flow) return;
      delete l.flows.claude;
      if (exitCode === 0) {
        // Signed in with its own login: that's what its workers use from now on.
        const s = this.load(id);
        delete s.claude;
        this.save(id, s);
        l.claude = { status: 'busy' };
      } else l.claude = { status: 'none', error: lastWords(out) || 'Signing in stopped before it finished' };
      this.onChange(id);
      void this.look(id, true);
    });
    l.flows.claude = flow;
    l.claude = { status: 'busy', pending: {} };
    this.onChange(id);
    return undefined;
  }

  private startGithub(id: string): string | undefined {
    if (!this.gh) return "The GitHub CLI (gh) isn't installed on the office's machine";
    this.stop(id, 'github');
    const l = this.get(id);
    const env = { ...this.githubEnv(id), BROWSER: 'true', GH_BROWSER: 'true' };
    // Over pipes, gh prints the one-time code and the page, then waits for GitHub to say yes.
    const p = spawn(this.gh, ['auth', 'login', '--hostname', 'github.com', '--git-protocol', 'https', '--web', '--insecure-storage', '--skip-ssh-key'], { cwd: this.home(id), env, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '';
    const flow: Flow = { stop: () => p.kill() };
    const timer = setTimeout(flow.stop, FLOW_MS);
    const onData = (d: Buffer) => {
      out = (out + d.toString('utf8')).slice(-20_000);
      if (l.flows.github !== flow || l.github.pending?.code) return;
      const code = /one-time code:\s*([A-Z0-9]{4}-[A-Z0-9]{4})/i.exec(out)?.[1];
      if (!code) return;
      const url = /https:\/\/github\.com\/login\/device\S*/.exec(out)?.[0] ?? 'https://github.com/login/device';
      l.github = { status: 'busy', pending: { url, code } };
      this.onChange(id);
    };
    p.stdout.on('data', onData);
    p.stderr.on('data', onData);
    p.on('error', (err) => {
      if (l.flows.github !== flow) return;
      delete l.flows.github;
      clearTimeout(timer);
      l.github = { status: 'none', error: `Couldn't start gh: ${err.message}` };
      this.onChange(id);
    });
    p.on('exit', (exitCode) => {
      clearTimeout(timer);
      if (l.flows.github !== flow) return;
      delete l.flows.github;
      if (exitCode === 0) {
        const s = this.load(id);
        delete s.github;
        this.save(id, s);
        l.github = { status: 'busy' };
      } else l.github = { status: 'none', error: lastWords(out) || 'Signing in stopped before it finished' };
      this.onChange(id);
      void this.look(id, true);
    });
    l.flows.github = flow;
    l.github = { status: 'busy', pending: {} };
    this.onChange(id);
    return undefined;
  }

  private async lookClaude(id: string) {
    const l = this.get(id);
    if (l.flows.claude) return;
    const s = this.load(id);
    const how = this.how(id, s, 'claude');
    if (!this.claude) {
      l.claude = how === 'token' ? { status: 'ok', who: 'a pasted token' } : { status: 'none', error: "Claude Code isn't installed on the office's machine" };
      return;
    }
    const env = how === 'office' ? this.base() : this.apply(id, this.base(), [], 'claude');
    const r = await run(this.claude, ['auth', 'status', '--json'], env);
    let status: { loggedIn?: boolean; email?: string; subscriptionType?: string; authMethod?: string } = {};
    try {
      status = JSON.parse(r.out);
    } catch {
      // older Claude Code, or it failed: nothing to go on
    }
    if (l.flows.claude) return;
    const plan = status.subscriptionType ? ` · ${status.subscriptionType[0].toUpperCase()}${status.subscriptionType.slice(1)}` : '';
    const pasted = s.claude?.use === 'token' ? (API_KEY.test(s.claude.token) ? 'an API key' : 'a token from claude setup-token') : 'a token';
    // A token in the environment is taken on trust: whether it works shows when a worker starts.
    const who = status.loggedIn || how === 'token' ? `${status.email ?? pasted}${plan}` : undefined;
    // Signed out, `claude auth status` still answers (and exits 1); anything else went wrong.
    l.claude = who ? { status: 'ok', who } : { status: 'none', error: r.out ? undefined : r.last || undefined };
    this.remember(id, 'claude', how === 'office' ? undefined : who);
  }

  private async lookGithub(id: string) {
    const l = this.get(id);
    if (l.flows.github) return;
    const s = this.load(id);
    const how = this.how(id, s, 'github');
    if (!this.gh) {
      l.github = { status: 'none', error: "The GitHub CLI (gh) isn't installed on the office's machine" };
      return;
    }
    const r = await run(this.gh, ['api', 'user', '--jq', '{login, id, name}'], how === 'office' ? this.base() : this.githubEnv(id));
    if (l.flows.github) return;
    let user: { login?: string; id?: number; name?: string | null } = {};
    try {
      user = r.code === 0 ? JSON.parse(r.out) : {};
    } catch {
      // not JSON: treated as not signed in
    }
    if (user.login) {
      l.github = { status: 'ok', who: `@${user.login}` };
      if (how !== 'office') this.writeGitConfig(id, { name: user.name?.trim() || user.login, email: `${user.id}+${user.login}@users.noreply.github.com` });
    } else {
      const signedOut = /auth login|not logged in|authenticat|401|bad credentials/i.test(r.last);
      l.github = { status: 'none', error: signedOut || !r.last ? undefined : r.last };
    }
    this.remember(id, 'github', how === 'office' ? undefined : l.github.who);
  }

  private async lookBitbucket(id: string) {
    const l = this.get(id);
    if (l.flows.bitbucket) return;
    const s = this.load(id);
    const how = this.how(id, s, 'bitbucket');
    if (!this.bb) {
      l.bitbucket = { status: 'none', error: "The Bitbucket CLI (bb) isn't installed on the office's machine" };
      return;
    }
    const r = await run(this.bb, ['auth', 'status', '--json'], how === 'office' ? this.base() : this.bitbucketEnv(id));
    if (l.flows.bitbucket) return;
    let user: { authenticated?: boolean; user?: { username?: string; displayName?: string } } = {};
    try {
      user = r.code === 0 ? JSON.parse(r.out) : {};
    } catch {
      // not JSON: treated as not signed in
    }
    const name = user.user?.username?.trim();
    if (user.authenticated && name) l.bitbucket = { status: 'ok', who: name };
    else {
      const signedOut = /auth login|not (logged in|authenticated)|1001|authenticat|credentials/i.test(r.last || r.out);
      l.bitbucket = { status: 'none', error: signedOut || !r.last ? undefined : r.last };
    }
    this.remember(id, 'bitbucket', how === 'office' ? undefined : l.bitbucket.who);
  }

  /** Keeps who the last look found, for the next start of the office. */
  private remember(id: string, which: SignInKind, who: string | undefined) {
    const s = this.load(id);
    if ((s.seen?.[which] ?? undefined) === who) return;
    s.seen = { ...s.seen, [which]: who };
    if (!who) delete s.seen[which];
    this.save(id, s);
  }

  private async logout(id: string, which: SignInKind) {
    if (which === 'claude') {
      if (this.claude) await run(this.claude, ['auth', 'logout'], this.claudeEnv(id));
      return;
    }
    if (which === 'bitbucket') {
      if (this.bb) await run(this.bb, ['auth', 'logout'], this.bitbucketEnv(id));
      // bb's own file, wherever this platform keeps it under the account's home (see bitbucketEnv).
      rmSync(path.join(this.bitbucketHome(id), '.config', 'bb', 'config.json'), { force: true });
      return;
    }
    if (this.gh) await run(this.gh, ['auth', 'logout', '--hostname', 'github.com'], this.githubEnv(id));
    rmSync(path.join(this.home(id), 'gh', 'hosts.yml'), { force: true });
  }
  private seed(dir: string, change?: (c: any) => void) { return accountConfig.seed({base:this.base,home:this.home.bind(this),gh:this.gh,seed:this.seed.bind(this)},dir, change); }

  private trust(configDir: string, dirs: string[]) { return accountConfig.trust({base:this.base,home:this.home.bind(this),gh:this.gh,seed:this.seed.bind(this)},configDir, dirs); }

  private writeGitConfig(id: string, user?: { name: string; email: string }) { return accountConfig.writeGitConfig({base:this.base,home:this.home.bind(this),gh:this.gh,seed:this.seed.bind(this)},id, user); }

}

/** Terminal output as plain text: no colors, links or cursor moves. */
function plain(s: string): string {
  return s
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/\x1b[@-_]/g, '')
    .replace(/\r\n?/g, '\n');
}

/** The last thing a command said, minus the link and the prompt, for an error line. */
function lastWords(s: string): string {
  const lines = plain(s)
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/https?:\/\/|paste code|opening browser|press enter/i.test(l));
  return (lines.at(-1) ?? '').slice(0, 300);
}

/** Runs a command to the end; never rejects. `last` is the last line it said on stderr (or stdout). */
function run(cmd: string, args: string[], env: Record<string, string>, input?: string): Promise<{ code: number; out: string; last: string }> {
  return new Promise((resolve) => {
    const p = execFile(cmd, args, { env, timeout: LOOK_TIMEOUT_MS, maxBuffer: 1024 * 1024, encoding: 'utf8' }, (err, stdout, stderr) => {
      const e = err as { code?: number | string } | null;
      const code = !e ? 0 : typeof e.code === 'number' ? e.code : -1;
      const last = lastWords(stderr || (err && !stdout ? err.message : ''));
      resolve({ code, out: stdout.trim(), last });
    });
    if (input !== undefined) p.stdin?.end(input);
    else p.stdin?.end();
  });
}

/** Compatibility name used by provider adapters for a per-account forge environment. */
export type GhAs = ForgeAs;
