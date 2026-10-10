import test from 'node:test';
import assert from 'node:assert/strict';
import headless from '@xterm/headless';
import { TuiTerminal, MOUSE_OFF } from '../src/server/tui-terminal.js';

const text = (term: InstanceType<typeof headless.Terminal>) => {
  const buf = term.buffer.active;
  return Array.from({ length: term.rows }, (_, y) => buf.getLine(buf.viewportY + y)?.translateToString(true) ?? '').join('\n');
};

test('worker history scrolls locally inside the host alternate screen with colors and live recovery', async t => {
  const host = new headless.Terminal({ cols: 40, rows: 6, allowProposedApi: true });
  const pending: Promise<void>[] = [];
  const viewer = new TuiTerminal(40, 6, data => pending.push(new Promise(resolve => host.write(data, resolve))));
  const settle = async () => { await Promise.all(pending); pending.length = 0; };
  t.after(() => { viewer.dispose(); host.dispose(); });
  await new Promise<void>(resolve => host.write('\x1b[?1049h', resolve));
  await viewer.write('\x1b[?1049h' + Array.from({ length: 20 }, (_, i) => `\x1b[31mhistory ${i}\x1b[0m\r\n`).join(''));
  await settle();
  assert.ok(text(host).includes('history 19'));
  assert.equal(viewer.input('\x1b[5~'), ''); await settle();
  assert.ok(text(host).includes('history 10'));
  assert.ok(!text(host).includes('history 19'));
  assert.equal(host.buffer.active.getLine(0)?.getCell(0)?.getFgColor(), 1);
  const previous = text(host);
  await viewer.write('new output\r\n'); await settle();
  assert.equal(text(host), previous, 'output must not pull a reader away from history');
  assert.equal(viewer.input('hello\x03'), 'hello\x03'); await settle();
  assert.ok(text(host).includes('new output'));
});

test('wheel and split page gestures stay local; ordinary keys and application clicks are preserved', async t => {
  let output = '';
  const viewer = new TuiTerminal(40, 6, data => { output += data; });
  t.after(() => viewer.dispose());
  await viewer.write(Array.from({ length: 20 }, (_, i) => `line ${i}\r\n`).join(''));
  output = '';
  assert.equal(viewer.input('\x1b[<64;2;3M'), '');
  assert.ok(output.includes('line 12'));
  assert.equal(viewer.input('\x1b[6'), '');
  assert.equal(viewer.input('~'), '');
  assert.equal(viewer.input('\x1b[A\x1b\r'), '\x1b[A\x1b\r');
  assert.equal(viewer.input('\x1b[<0;2;3M'), '', 'tracking enabled locally must not inject clicks into shells');
  await viewer.write('\x1b[?1000h\x1b[?1006h');
  assert.equal(viewer.input('\x1b[<0;2;3M'), '\x1b[<0;2;3M');
  assert.equal(viewer.input('\x1b[200~paste \x1b[5~'), '\x1b[200~paste \x1b[5~');
  assert.equal(viewer.input('\x1b[20'), '');
  assert.equal(viewer.input('1~'), '\x1b[201~');
  assert.equal(viewer.input('\x1b'), '');
  assert.equal(viewer.flushInput(), '\x1b');
  viewer.dispose();
  assert.ok(output.includes(MOUSE_OFF));
});

test('snapshots replace old history and resize safely', async t => {
  let output = '';
  const viewer = new TuiTerminal(40, 6, data => { output += data; });
  t.after(() => viewer.dispose());
  await viewer.write('OLD WORKER\r\n');
  await viewer.write('NEW SNAPSHOT\r\n', true, 30, 8);
  output = ''; viewer.input('\x1b[5~');
  assert.ok(output.includes('NEW SNAPSHOT'));
  assert.ok(!output.includes('OLD WORKER'));
  viewer.resize(20, 4);
});


test('live redraw preserves cursor and input modes and answers terminal queries', async t => {
  const host = new headless.Terminal({ cols: 40, rows: 6, allowProposedApi: true });
  const pending: Promise<void>[] = [], replies: string[] = [];
  const viewer = new TuiTerminal(40, 6, data => pending.push(new Promise(resolve => host.write(data, resolve))), data => replies.push(data));
  t.after(() => { viewer.dispose(); host.dispose(); });
  await viewer.write('prompt> \x1b[?1h\x1b[?2004h\x1b[5n');
  await Promise.all(pending);
  assert.equal(host.buffer.active.cursorX, 8);
  assert.equal(host.buffer.active.cursorY, 0);
  assert.equal(host.modes.applicationCursorKeysMode, true);
  assert.equal(host.modes.bracketedPasteMode, true);
  assert.ok(replies.includes('\x1b[0n'));
});
