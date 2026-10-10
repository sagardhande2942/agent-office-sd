// Staging a demonstration of what you just shipped, against the actual build.
//
//   npm run build && npm run reel:record -- --reel reel.json
//
// This is the other half of `office-workers cinema add` (see docs/cinema.md). It runs the built client
// in a real browser against a real office, walks the steps in the reel file, and screenshots the build
// after each one — so the pictures in the screening room are the feature behaving, not a drawing of it.
// The reel it writes goes to the office with `office-workers cinema add`.
//
// With no `--start` it brings up an office of its own from the production bundle and takes it away again
// afterwards; with one it records against the office you name, which is how you film against your own
// floor or a deployment.
//
//   reel.json:
//   {
//     "title": "Screening room",                  // what the demonstration shows
//     "pr": 99,                                   // the pull request it demonstrates (optional)
//     "shots": [
//       { "caption": "E at the screen opens the window", "key": "KeyE", "wait": 800 },
//       { "caption": "The reel is captioned shot by shot", "click": ".reel-title", "wait": 600 },
//       { "caption": "It goes on the wall for everyone", "click": ".cinema-bar .btn", "wait": 1200 }
//     ]
//   }
//
// A step may also `goto` a path, `type`, `evaluate` a snippet of JS in the page, or `shot` alone. All
// of it is optional but the caption, which is the point of the whole thing.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { REEL_SHOTS_MAX, REEL_TITLE_MAX, SHOT_CAPTION_MAX } from '../../shared/cinema.js';

/** Reads `--flag value` and `--flag=value`, and returns the first one asked for. */
export function flag(args: readonly string[], name: string, fallback?: string): string | undefined {
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    const eq = arg.indexOf('=');
    if (eq > 0 && arg.slice(0, eq) === `--${name}`) return arg.slice(eq + 1);
    if (arg === `--${name}` && i + 1 < args.length && !args[i + 1].startsWith('--')) return args[i + 1];
  }
  return fallback;
}

export interface ReelStep {
  caption: string;
  goto?: string;
  click?: string;
  key?: string;
  type?: string;
  evaluate?: string;
  wait?: number;
}
export interface Reel {
  title: string;
  pr?: number;
  shots: ReelStep[];
}

/** The reel a file holds, or a string saying what's wrong with it. */
export function readReelFile(text: string): Reel | string {
  let reel: unknown;
  try {
    reel = JSON.parse(text);
  } catch {
    return 'The reel is not JSON.';
  }
  const r = (reel ?? {}) as { title?: unknown; pr?: unknown; shots?: unknown };
  const title = typeof r.title === 'string' ? r.title.trim() : '';
  if (!title) return 'Say what the reel shows: "title".';
  if (!Array.isArray(r.shots) || !r.shots.length) return 'A reel needs at least one shot.';
  if (r.shots.length > REEL_SHOTS_MAX) return `A reel is at most ${REEL_SHOTS_MAX} shots: keep the demonstration short.`;
  const shots: ReelStep[] = [];
  for (const raw of r.shots) {
    const s = (raw ?? {}) as { caption?: unknown };
    const caption = typeof s.caption === 'string' ? s.caption.trim() : '';
    if (!caption) return 'Every shot needs a caption saying what the behaviour shown is.';
    shots.push({ ...(s as ReelStep), caption: caption.slice(0, SHOT_CAPTION_MAX) });
  }
  // A pull request is a positive whole number, or nothing: `Number(null)` and `Number('')` are 0.
  const pr = Number(r.pr);
  const hasPr = r.pr !== undefined && r.pr !== null && r.pr !== '' && Number.isSafeInteger(pr) && pr > 0;
  return { title: title.slice(0, REEL_TITLE_MAX), ...(hasPr ? { pr } : {}), shots };
}

/** Where Chromium is: playwright-core's download, unless the caller says otherwise. */
export function chromiumPath(): string {
  if (process.env.CHROMIUM_PATH) return process.env.CHROMIUM_PATH;
  const cache = path.join(homedir(), '.cache/ms-playwright');
  const build = readdirSync(cache).find((d) => d.startsWith('chromium-'));
  if (!build) throw new Error(`No Chromium under ${cache}. Set CHROMIUM_PATH to a Chrome or Chromium binary.`);
  return path.join(cache, build, 'chrome-linux64/chrome');
}

/** The office the recording runs against, and whether this brought it up (and so must take it away). */
async function officeFor(start: string | undefined, password: string) {
  if (start) return { base: start, password, office: null };
  // A checkout, because the office opens whatever directory it is given as a floor, and a floor with no
  // branch has no desks to record in.
  const dir = path.join(homedir(), '.cache', 'agent-office-reel');
  if (!existsSync(path.join(dir, '.git'))) {
    mkdirSync(dir, { recursive: true });
    spawnSync('git', ['init', '-q', '-b', 'main', dir]);
    spawnSync('git', ['-c', 'user.name=Reel', '-c', 'user.email=reel@example.test', 'commit', '-q', '--allow-empty', '-m', 'fixture'], { cwd: dir });
  }
  const { loadConfig } = await import('../config.js');
  const { startServer } = await import('../server.js');
  const cfg = loadConfig([dir, '--password', password, '--no-open']);
  cfg.port = 0; // whichever port is free: this office is only up while the recording is.
  const office = await startServer(cfg, { publicDir: path.resolve('dist/public') });
  const { port } = office.server.address() as { port: number };
  return { base: `http://127.0.0.1:${port}`, password, office };
}

export interface RecordOptions {
  /** The reel to walk: the title, and a caption and a few actions per shot. */
  reel: Reel;
  /** An office that is already running, with its password; without one, this starts its own. */
  start?: string;
  password?: string;
  /** Says each shot as it is taken. */
  say?(line: string): void;
}

/**
 * Walks the reel in a real browser against the real build and returns each shot's PNG, as the data URLs
 * an agent's browser would have produced. Nothing is written to disk: what to do with the reel is the
 * caller's business.
 */
export async function recordReel(opts: RecordOptions) {
  const password = opts.password ?? 'record-password';
  const { base, office } = await officeFor(opts.start, password);
  const { chromium } = await import('playwright-core');
  const browser = await chromium.launch({ executablePath: chromiumPath(), headless: true, args: ['--no-sandbox', '--enable-unsafe-swiftshader'] });
  const shots: { caption: string; image: string }[] = [];
  try {
    const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
    // A profile and no Lite upsell: the office asks for both before it connects at all.
    await context.addInitScript(() => {
      localStorage.setItem('agent-office.profile', JSON.stringify({ name: 'Reel recorder', color: '#4cc9f0', look: { skin: 0, hair: 0, style: 0 } }));
      localStorage.setItem('agent-office.lite-declined', '1');
    });
    // Before the page opens its socket: a page loaded signed out has nothing to connect with.
    const login = await context.request.post(`${base}/api/login`, { data: { password } });
    if (!login.ok()) throw new Error(`${base} didn't take the password (${login.status()})`);
    const page = await context.newPage();
    page.setDefaultTimeout(30_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));
    await page.goto(base);
    // The office is up when the page has its renderer and the socket has come up.
    await page.waitForFunction(() => (window as unknown as { __office?: { net?: { up?: boolean } } }).__office?.net?.up, null, { timeout: 60_000 });
    await page.waitForSelector('#loading', { state: 'hidden', timeout: 60_000 });
    if (errors.length) throw new Error(`the build logged errors on load: ${errors.join('; ')}`);
    // The canvas takes the keyboard, which is where the office binds its keys: a headless page nobody
    // has clicked is not the focused one, and a key press would go nowhere.
    await page.evaluate(() => document.getElementById('scene')?.focus());

    for (const [i, step] of opts.reel.shots.entries()) {
      // `evaluate` first: it is how a step puts you where the step is about to happen.
      if (step.goto) await page.goto(new URL(step.goto, base).href);
      if (step.evaluate) await page.evaluate(step.evaluate);
      if (step.click) await page.click(step.click, { timeout: 10_000 });
      if (step.key) await page.keyboard.press(step.key);
      if (step.type) await page.keyboard.type(step.type);
      await page.waitForTimeout(step.wait ?? 700);
      // A frame, so the picture is of the build settled rather than mid-draw.
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const png = (await page.screenshot({ type: 'png', animations: 'disabled', timeout: 60_000 })).toString('base64');
      shots.push({ caption: step.caption, image: `data:image/png;base64,${png}` });
      opts.say?.(`  shot ${i + 1}/${opts.reel.shots.length}: ${step.caption}`);
    }
    return { shots, base };
  } finally {
    await browser.close();
    office?.shutdown();
  }
}
