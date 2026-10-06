import {existsSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
import os from 'node:os';
interface ConfigContext { base():Record<string,string>; home(id:string):string; gh:string|null; seed(dir:string,change?:(c:any)=>void):void; }
function quote(v:string):string { return '"'+v.replace(/[\p{C}]/gu,'').replace(/\\/g,'\\\\').replace(/"/g,'\\"')+'"'; }
export function seed(ctx:ConfigContext,dir: string, change?: (c: any) => void) {
    const file = path.join(dir, '.claude.json');
    let c: any = {};
    try {
      c = JSON.parse(readFileSync(file, 'utf8'));
    } catch {
      // new
    }
    const before = JSON.stringify(c);
    c.hasCompletedOnboarding = true;
    change?.(c);
    if (JSON.stringify(c) === before) return;
    try {
      writeFileSync(file, JSON.stringify(c, null, 2), { mode: 0o600 });
    } catch (err) {
      console.error(`agent-office: couldn't write ${file}: ${(err as Error).message}`);
    }
  }
export function trust(ctx:ConfigContext,configDir: string, dirs: string[]) {
    let office: any;
    try {
      const base = ctx.base();
      office = JSON.parse(readFileSync(base.CLAUDE_CONFIG_DIR ? path.join(base.CLAUDE_CONFIG_DIR, '.claude.json') : path.join(os.homedir(), '.claude.json'), 'utf8'));
    } catch {
      return;
    }
    const trusted = (d: string) => office?.projects?.[d]?.hasTrustDialogAccepted === true;
    if (!dirs.some(trusted)) return;
    ctx.seed(configDir, (c) => {
      c.projects ??= {};
      for (const d of dirs) c.projects[d] = { ...c.projects[d], hasTrustDialogAccepted: true };
    });
  }
export function writeGitConfig(ctx:ConfigContext,id: string, user?: { name: string; email: string }) {
    const home = ctx.home(id);
    const base = ctx.base();
    const xdg = base.XDG_CONFIG_HOME || path.join(os.homedir(), '.config');
    const includes = base.GIT_CONFIG_GLOBAL ? [base.GIT_CONFIG_GLOBAL] : [path.join(xdg, 'git', 'config'), path.join(os.homedir(), '.gitconfig')];
    const lines = ['# Written by Agent Office: git for this account, on top of the office machine’s own settings.', '[include]', ...includes.map((p) => `\tpath = ${quote(p)}`)];
    if (ctx.gh) {
      for (const host of ['https://github.com', 'https://gist.github.com']) {
        lines.push(`[credential ${quote(host)}]`, '\thelper =', `\thelper = ${quote(`!'${ctx.gh.replace(/'/g, `'\\''`)}' auth git-credential`)}`);
      }
    }
    if (user) lines.push('[user]', `\tname = ${quote(user.name)}`, `\temail = ${quote(user.email)}`);
    const text = `${lines.join('\n')}\n`;
    const file = path.join(home, 'gitconfig');
    try {
      if (existsSync(file) && readFileSync(file, 'utf8') === text) return;
      writeFileSync(file, text, { mode: 0o600 });
    } catch (err) {
      console.error(`agent-office: couldn't write ${file}: ${(err as Error).message}`);
    }
  }
