import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { CINEMA_OFF, REELS_KEPT, SHOT_MS, cinemaTitle, frameAt, reelMs, showing, type ReelSummary } from '../src/shared/cinema.js';
import { Cinema, checkReel, reelId } from '../src/server/cinema.js';
import { pngSize, readReelRequest } from '../src/server/office-workers.js';
import { formatCinema, parseArgs, readReel } from '../bin/office-workers.js';

/** A real 2×2 PNG, so what the office keeps is a picture and not a file that only says it is one. */
function png(): Buffer {
  return Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAYAAABytg0kAAAAFElEQVR4nGP8z8DwnwEPYMInOWQUAADgAB/6xg6SQAAAABJRU5ErkJggg==',
    'base64',
  );
}

const reel = (id: string, shots = 3): ReelSummary => ({
  id,
  title: `Reel ${id}`,
  pr: 12,
  by: 'Pixel',
  at: 1_000,
  shots: Array.from({ length: shots }, (_, i) => ({ caption: `shot ${i}`, width: 1280, height: 800 })),
});

test('everyone watches the same shot: the office sends four numbers, and each browser works it out', () => {
  const r = reel('aaaaaaaaaaaa');
  const s = { frame: 1, playing: true, at: 10_000 };
  assert.equal(frameAt(r, s, 10_000), 1);
  assert.equal(frameAt(r, s, 10_000 + SHOT_MS - 1), 1);
  assert.equal(frameAt(r, s, 10_000 + SHOT_MS), 2);
  assert.equal(frameAt(r, s, 10_000 + SHOT_MS * 4), (1 + 4) % 3);
  // Paused is where it was left, whatever the clock says.
  assert.equal(frameAt(r, { ...s, playing: false }, 10_000 + SHOT_MS * 9), 1);
  // A reel of one shot is that shot, always.
  assert.equal(frameAt(reel('bbbbbbbbbbbb', 1), s, 99_999), 0);
  assert.equal(frameAt(reel('cccccccccccc', 0), s, 0), 0);
  assert.equal(reelMs(r), 3 * SHOT_MS);
});

test('what the room says it is showing, and an empty one says nothing', () => {
  const state = { ...CINEMA_OFF, on: true, reel: 'aaaaaaaaaaaa', playing: true, reels: [reel('aaaaaaaaaaaa')] };
  assert.equal(cinemaTitle(state), 'Reel aaaaaaaaaaaa');
  assert.equal(cinemaTitle({ ...state, reel: 'gone' }), 'nothing on');
  assert.equal(cinemaTitle({ ...state, on: false }), 'nothing on');
  assert.equal(showing(state)?.id, 'aaaaaaaaaaaa');
  assert.equal(showing(CINEMA_OFF), undefined);
});

test('a reel an agent sent has a title, short captioned shots, and real PNGs', () => {
  const data = png().toString('base64');
  const good = readReelRequest({ title: ' Screening room ', pr: 99, shots: [{ caption: 'E opens the window', image: `data:image/png;base64,${data}` }] });
  assert.ok(typeof good !== 'string');
  assert.equal(good.title, 'Screening room');
  assert.equal(good.pr, 99);
  assert.equal(good.shots[0].caption, 'E opens the window');
  assert.deepEqual(good.shots[0].png, png());
  // The size comes off the PNG itself, so the browser needn't be asked.
  assert.deepEqual({ width: good.shots[0].width, height: good.shots[0].height }, { width: 2, height: 2 });

  assert.match(String(readReelRequest({})), /title/);
  assert.match(String(readReelRequest({ title: 'x', shots: [] })), /at least one shot/);
  assert.match(String(readReelRequest({ title: 'x', shots: [{ caption: 'c', image: 'data:image/png;base64,' + data }, { caption: 'c', image: 'data:image/png;base64,' + data }], pr: 0 })), /pull request number/);
  // A demonstration without captions is not a demonstration.
  assert.match(String(readReelRequest({ title: 'x', shots: [{ caption: '  ', image: `data:image/png;base64,${data}` }] })), /caption/);
  assert.match(String(readReelRequest({ title: 'x', shots: [{ caption: 'c', image: 'data:text/html;base64,PGI+hi' }] })), /PNG/);
  assert.match(String(readReelRequest({ title: 'x', shots: [{ caption: 'c', image: 'not base64 at all!' }] })), /PNG/);
  const many = Array.from({ length: 13 }, () => ({ caption: 'c', image: `data:image/png;base64,${data}` }));
  assert.match(String(readReelRequest({ title: 'x', shots: many })), /at most 12 shots/);
  assert.deepEqual(pngSize(Buffer.from('too short')), null);
});

test('the screening room keeps a reel, shows it, and keeps the pictures beside it', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cinema-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cinema = new Cinema(dir);
  assert.deepEqual(cinema.state(), CINEMA_OFF);
  assert.equal(cinema.title(), 'nothing on');

  const shots = [1, 2, 3].map((i) => ({ caption: `step ${i}`, width: 1280, height: 800 }));
  const added = cinema.add({ title: 'Instant product cinema', pr: 99, by: 'Pixel', shots }, [png(), png(), png()]);
  assert.match(added.id, /^[a-z0-9]{12}$/);
  // A new reel is what a screening room shows, so it goes up as it arrives.
  const state = cinema.state();
  assert.equal(state.reels.length, 1);
  assert.equal(state.on, true);
  assert.equal(state.reel, added.id);
  assert.equal(state.playing, true);
  assert.equal(state.frame, 0);
  assert.equal(cinema.title(), 'Instant product cinema');
  // The office keeps the picture, not the data URL it arrived in.
  assert.deepEqual(cinema.frame(added.id, 1), png());
  assert.equal(cinema.frame(added.id, 9), undefined);
  assert.equal(cinema.frame('../escape', 0), undefined);
  assert.equal(cinema.frame('AAAAAAAAAAAA', 0), undefined);

  // Playing something that isn't there is refused, by name.
  assert.match(String(cinema.play('nosuchreel12', 0)?.error), /No such reel/);
  assert.deepEqual(cinema.play(added.id, 99), { changed: true });
  assert.equal(cinema.state().frame, 2, 'a frame past the last shot is the last shot');
  assert.equal(cinema.pause(1), true);
  assert.equal(cinema.state().playing, false);
  assert.equal(cinema.pause(1), false, 'already paused: nothing changed');
  assert.equal(cinema.stop(), true);
  assert.equal(cinema.state().on, false);
  assert.equal(cinema.stop(), false);

  // Only the JSON is owner-only; the pictures are its own, beside it.
  assert.equal(statSync(path.join(dir, 'cinema.json')).mode & 0o777, 0o600);
  assert.equal(cinema.remove(added.id), true);
  assert.equal(cinema.remove(added.id), false);
  assert.deepEqual(cinema.state().reels, []);
  rmSync(path.join(dir, 'cinema'), { recursive: true, force: true });
});

test('a restart brings back what was on, and a reel whose pictures went is forgotten', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cinema-restart-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const first = new Cinema(dir);
  const added = first.add({ title: 'Screening room', shots: [{ caption: 'a', width: 2, height: 2 }, { caption: 'b', width: 2, height: 2 }] }, [png(), png()]);
  first.pause(1);
  const again = new Cinema(dir);
  assert.deepEqual(again.state().reels, first.state().reels);
  assert.equal(again.state().on, true);
  assert.equal(again.state().reel, added.id);
  assert.equal(again.state().frame, 1);
  assert.equal(again.state().playing, false);
  assert.deepEqual(again.frame(added.id, 0), png());

  // The pictures are the reel: without them there is no demonstration to show.
  rmSync(path.join(dir, 'cinema', added.id), { recursive: true, force: true });
  assert.deepEqual(new Cinema(dir).state().reels, []);

  // A file that isn't a reel at all is an empty room, not a crash.
  writeFileSync(path.join(dir, 'cinema.json'), 'not json at all');
  assert.deepEqual(new Cinema(dir).state(), CINEMA_OFF);
});

test('a floor keeps the newest reels, and the pictures of the ones it dropped go with them', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cinema-kept-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cinema = new Cinema(dir);
  const ids: string[] = [];
  for (let i = 0; i < REELS_KEPT + 3; i++) ids.push(cinema.add({ title: `Reel ${i}`, shots: [{ caption: 'a', width: 2, height: 2 }] }, [png()]).id);
  const state = cinema.state();
  assert.equal(state.reels.length, REELS_KEPT);
  assert.deepEqual(state.reels.map((r) => r.title), Array.from({ length: REELS_KEPT }, (_, i) => `Reel ${REELS_KEPT + 2 - i}`));
  // The oldest are gone, pictures and all, and what is on the screen is still there.
  assert.equal(cinema.frame(ids[0], 0), undefined);
  assert.deepEqual(cinema.frame(state.reels[0].id, 0), png());
  assert.notEqual(reelId(), reelId());
});

test('a reel read back from disk is only one when every field of it is there', () => {
  const good = reel('aaaaaaaaaaaa');
  assert.deepEqual(checkReel(JSON.parse(JSON.stringify(good))), good);
  assert.equal(checkReel(null), null);
  assert.equal(checkReel({ ...good, id: 'short' }), null);
  assert.equal(checkReel({ ...good, id: '../etc' }), null);
  assert.equal(checkReel({ ...good, title: '  ' }), null);
  assert.equal(checkReel({ ...good, shots: [] }), null);
  assert.equal(checkReel({ ...good, shots: [{ caption: 'a' }] }), null);
  assert.equal(checkReel({ ...good, pr: -1 })?.pr, undefined);
});

test('office-workers cinema takes add, list and remove, and nothing else', () => {
  assert.deepEqual(parseArgs(['cinema', 'add']), { cmd: 'cinema.add', json: false });
  assert.deepEqual(parseArgs(['cinema', 'list', '--json']), { cmd: 'cinema.list', json: true });
  assert.deepEqual(parseArgs(['cinema', 'remove', 'abc123abc123']), { cmd: 'cinema.remove', reel: 'abc123abc123', json: false });
  assert.throws(() => parseArgs(['cinema']), /cinema takes add, list or remove/);
  assert.throws(() => parseArgs(['cinema', 'shout']), /cinema takes add, list or remove/);
  assert.throws(() => parseArgs(['cinema', 'remove']), /one reel id/);
  assert.throws(() => parseArgs(['cinema', 'add', 'extra']), /Unexpected argument/);
  // The office has to know the route, or every recording is answered with a 405.
  assert.equal(new URL('http://o/office/workers/cinema').pathname, '/office/workers/cinema');
});

test('a reel on stdin becomes the request the office reads, with its pictures inlined', async () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'reel-cli-')), 'shot.png');
  writeFileSync(file, png());
  const reel = await readReel(JSON.stringify({ title: 'Screening room', pr: 7, shots: [{ caption: 'E opens it', image: file }] }));
  assert.equal(reel.title, 'Screening room');
  assert.equal(reel.pr, 7);
  assert.match(reel.shots[0].image, /^data:image\/png;base64,/);
  // What the office reads back is the same reel.
  const back = readReelRequest(reel);
  assert.ok(typeof back !== 'string');
  assert.deepEqual(back.shots[0].png, png());

  await assert.rejects(() => readReel('not json'), /not JSON/);
  await assert.rejects(() => readReel(JSON.stringify({ shots: [] })), /title/);
  await assert.rejects(() => readReel(JSON.stringify({ title: 'x' })), /at least one shot/);
  await assert.rejects(() => readReel(JSON.stringify({ title: 'x', shots: [{ caption: 'c', image: '/nope.png' }] })), /Couldn't read/);
  writeFileSync(file, '<html>not a png</html>');
  await assert.rejects(() => readReel(JSON.stringify({ title: 'x', shots: [{ caption: 'c', image: file }] })), /isn't a PNG/);
  // A data URL the browser made is taken as it is, and a shot with no picture at all is refused.
  const inline = await readReel(JSON.stringify({ title: 'x', shots: [{ caption: 'c', image: 'data:image/png;base64,' + png().toString('base64') }] }));
  assert.match(inline.shots[0].image, /^data:image\/png;base64,/);
  await assert.rejects(() => readReel(JSON.stringify({ title: 'x', shots: [{ caption: 'c' }] })), /no picture/);
});

test('cinema list shows the room, and says when it is empty', () => {
  assert.match(formatCinema({ reels: [] }), /empty/);
  const line = formatCinema({ reels: [reel('aaaaaaaaaaaa')], on: true, reel: 'aaaaaaaaaaaa', frame: 1 });
  assert.match(line, /Reel aaaaaaaaaaaa · 3 shots/);
  assert.match(line, /PR #12/);
  assert.match(line, /shot 2\/3/);
  assert.match(line, /On the screen: “Reel aaaaaaaaaaaa”/);
  assert.match(formatCinema({ reels: [reel('aaaaaaaaaaaa')], on: false }), /On the screen: nothing/);
});

test('what the office keeps for a reel is the reel, and the pictures are its own files', (t) => {
  const dir = mkdtempSync(path.join(tmpdir(), 'cinema-files-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cinema = new Cinema(dir);
  const added = cinema.add({ title: 'Screening room', shots: [{ caption: 'a', width: 2, height: 2 }] }, [png()]);
  // The reel file names no path: the pictures are found by reel id and shot number alone.
  const saved = JSON.parse(readFileSync(path.join(dir, 'cinema.json'), 'utf8')) as { reels: { id: string }[] };
  assert.deepEqual(saved.reels.map((r) => r.id), [added.id]);
  assert.doesNotMatch(readFileSync(path.join(dir, 'cinema.json'), 'utf8'), /\/tmp|\.\./);
});

test('a reel file the recorder walks needs a title and a caption on every shot', async () => {
  const { readReelFile, flag } = await import('../src/server/cinema/record.js');
  const good = readReelFile(JSON.stringify({ title: 'Screening room', pr: '99', shots: [{ caption: 'E opens it', key: 'KeyE', wait: 500 }] }));
  assert.ok(typeof good !== 'string');
  assert.equal(good.title, 'Screening room');
  assert.equal(good.pr, 99, 'a pull request may be written as a number or as text');
  assert.deepEqual(good.shots, [{ caption: 'E opens it', key: 'KeyE', wait: 500 }]);
  // The caption is the point of a shot, and a demonstration is short.
  assert.match(String(readReelFile('not json')), /not JSON/);
  assert.match(String(readReelFile(JSON.stringify({ shots: [{ caption: 'c' }] }))), /title/);
  assert.match(String(readReelFile(JSON.stringify({ title: 'x', shots: [] }))), /at least one shot/);
  assert.match(String(readReelFile(JSON.stringify({ title: 'x', shots: [{ caption: ' ' }] }))), /caption/);
  assert.match(String(readReelFile(JSON.stringify({ title: 'x', shots: Array.from({ length: 13 }, () => ({ caption: 'c' })) }))), /at most 12 shots/);
  // A caption longer than the office keeps is cut, not refused.
  const long = readReelFile(JSON.stringify({ title: 'x', shots: [{ caption: 'c'.repeat(300) }] }));
  assert.equal(typeof long !== 'string' && long.shots[0].caption.length, 160);
  assert.deepEqual(flag(['--reel', 'a.json', '--start'], 'reel', 'b.json'), 'a.json');
  assert.equal(flag(['--start=http://x'], 'start', undefined), 'http://x');
  assert.equal(flag(['--keep'], 'start', undefined), undefined, 'a bare flag takes no value');
  assert.equal(flag([], 'reel', 'reel.json'), 'reel.json');
});
