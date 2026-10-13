import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { execFileSync } from 'node:child_process';
import { loadConfig } from '../../src/server/config.ts';
import { startServer } from '../../src/server/server.ts';
export async function knowledgeFixture(settings = {}) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'office-knowledge-e2e-')); const project = path.join(home, 'project'); fs.mkdirSync(project);
  const git = (args, cwd = project) => execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  git(['init', '-b', 'main']); git(['config', 'user.name', 'Fixture']); git(['config', 'user.email', 'fixture@example.test']); git(['commit', '--allow-empty', '-m', 'fixture']);
  fs.mkdirSync(path.join(project, '.agent-office')); fs.writeFileSync(path.join(project, '.agent-office/knowledge.json'), JSON.stringify(settings));
  fs.mkdirSync(path.join(home, '.agent-office')); fs.writeFileSync(path.join(home, '.agent-office/floors.json'), JSON.stringify([{ id: 'local', name: 'Knowledge fixture', dir: project, palette: 0, addedBy: 'test', addedAt: Date.now() }]));
  const command = path.join(home, 'claude'); fs.writeFileSync(command, `#!${process.execPath}\nif(process.argv.includes('-p')||process.argv.includes('--print')){console.log(JSON.stringify({name:'Knowledge task',summary:'Fixture'}));process.exit(0);}setInterval(()=>{},1000);\n`, { mode: 0o755 });
  const cfg = loadConfig(['--home', home, '--port', '4600', '--password', 'knowledge-fixture', '--no-open', '--agent', command]); cfg.port = 0;
  const office = await startServer(cfg, { publicDir: path.resolve('dist/public') }); const floor = office.floors()[0]; await floor.ready;
  return { home, project, office, floor, git, base: `http://127.0.0.1:${office.server.address().port}`, async close() { office.shutdown(); fs.rmSync(home, { recursive: true, force: true }); } };
}
export function browserPath() {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  for (const root of [path.join(os.homedir(), '.cache/ms-playwright'), '/mnt/c/Nightshade/.cache/ms-playwright']) {
    if (!fs.existsSync(root)) continue;
    for (const dir of fs.readdirSync(root).filter(n => n.startsWith('chromium-')).reverse()) for (const leaf of ['chrome-linux64/chrome', 'chrome-linux/chrome']) {
      const file = path.join(root, dir, leaf); if (fs.existsSync(file)) return file;
    }
  }
  throw Error('Set CHROMIUM_PATH to installed Chromium');
}
