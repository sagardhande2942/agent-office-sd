// Replay a real PTY scroll check into a terminal emulator and capture its visible text.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import headless from '@xterm/headless';
import { chromium } from 'playwright-core';

const output = process.env.TUI_SCROLL_ARTIFACTS ?? '/tmp/agent-office-tui-scroll-evidence';
mkdirSync(output, { recursive: true });
const ansi = path.join(output, 'scrolled.ansi');
execFileSync(process.execPath, ['--import', 'tsx', '--import=#tests/css', '--test', 'tests/tui-session.test.ts'], {
  stdio: 'inherit', env: { ...process.env, TUI_SCROLL_EVIDENCE: ansi },
});
const terminal = new headless.Terminal({ cols: 120, rows: 30, allowProposedApi: true });
await new Promise(resolve => terminal.write('\x1b[?1049h' + readFileSync(ansi, 'utf8'), resolve));
const buffer = terminal.buffer.active;
const text = Array.from({ length: terminal.rows }, (_, y) => buffer.getLine(buffer.viewportY + y)?.translateToString(true) ?? '').join('\n');
assert.match(text, /HISTORY_ROW_20/);
assert.doesNotMatch(text, /TERMINAL_READY/);
const cache = path.join(os.homedir(), process.platform === 'darwin' ? 'Library/Caches/ms-playwright' : '.cache/ms-playwright');
const executable = process.env.CHROMIUM_PATH ?? path.join(cache, readdirSync(cache).find(name => name.startsWith('chromium-')),
  process.platform === 'darwin' ? 'chrome-mac-arm64/Google Chrome for Testing.app/Contents/MacOS/Google Chrome for Testing' : 'chrome-linux64/chrome');
const browser = await chromium.launch({ executablePath: executable, headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1220, height: 680 } });
  const escaped = text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
  await page.setContent(`<html><body style="margin:0;background:#1e1f2e;color:#eee;padding:20px"><pre style="margin:0;font:16px/21px monospace">${escaped}</pre></body></html>`);
  await page.screenshot({ path: path.join(output, 'scrolled-terminal.png') });
} finally { await browser.close(); terminal.dispose(); }
console.log(`PTY scroll replay screenshot: ${output}`);
