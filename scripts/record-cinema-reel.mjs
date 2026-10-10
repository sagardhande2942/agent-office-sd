// Records the screening room's own reel against an office that already has one on its screen, so the
// pictures in docs/cinema-evidence are this shipped feature doing what it says.
//
//   npm run build && node --import tsx scripts/record-cinema-reel.mjs
//
// The recording office is temporary and thrown away; the reel it shows while filming is read from
// docs/cinema-evidence/reel.json, the one committed beside this feature.
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { loadConfig } from '../src/server/config.ts';
import { startServer } from '../src/server/server.ts';
import { readReelRequest } from '../src/server/office-workers.ts';
import { recordReel } from '../src/server/cinema/record.ts';

const PASSWORD = 'cinema-reel';
const here = path.resolve(import.meta.dirname, '..');
const evidence = path.join(here, 'docs/cinema-evidence');

const dir = mkdtempSync(path.join(tmpdir(), 'office-cinema-reel-'));
const checkout = path.join(dir, 'project');
mkdirSync(checkout, { recursive: true });
spawnSync('git', ['init', '-q', '-b', 'main', checkout]);
spawnSync('git', ['-c', 'user.name=Reel', '-c', 'user.email=reel@example.test', 'commit', '-q', '--allow-empty', '-m', 'fixture'], { cwd: checkout });

const cfg = loadConfig([checkout, '--password', PASSWORD, '--no-open']);
cfg.port = 0;
const office = await startServer(cfg, { publicDir: path.join(here, 'dist/public') });
const base = `http://127.0.0.1:${office.server.address().port}`;

// The committed reel, put on the recording office's own screen, so the pictures show it working. Its
// shots are files beside this script, so they are read and inlined as the data URLs an agent would send.
const committed = JSON.parse(readFileSync(path.join(evidence, 'reel.json'), 'utf8'));
const ask = readReelRequest({
  title: committed.title,
  shots: committed.shots.map((s) => ({ caption: s.caption, image: `data:image/png;base64,${readFileSync(path.join(evidence, s.image)).toString('base64')}` })),
});
if (typeof ask === 'string') throw new Error(`the office refused the committed reel: ${ask}`);
const floor = office.floors()[0];
floor.cinema.add({ title: ask.title, by: 'the floor', shots: ask.shots.map(({ caption, width, height }) => ({ caption, width, height })) }, ask.shots.map((s) => s.png));
console.log(`Recording against ${base}: ${office.floors().map((f) => `${f.id} has ${f.cinema.state().reels.length} reel(s)`).join(', ')}.`);

// The shots of this feature's own demonstration, walked in that office: the build, the screen, E at it.
const at = (dx, dz, pitch) =>
  `const p=window.__office.player,it=window.__office.office.interactables.find(i=>i.kind==='cinema');p.pos.set(it.x+${dx},0,it.z+${dz});p.facing=0;p.camYaw=Math.PI;p.lookPitch=${pitch};p.updateCamera(true)`;
const reel = {
  title: 'Instant product cinema',
  shots: [
    { caption: 'The build runs: the office floor, its desks and its boards', wait: 2500 },
    { caption: 'A reel recorded against the build is on the screening room screen, with its caption under it', evaluate: at(-0.9, -3.4, 0.03), wait: 2600 },
    { caption: 'E at the screen opens the room: the reels down the side, the shot, and its caption', evaluate: at(0, -1.2, 0), wait: 900, key: 'KeyE' },
    { caption: 'Every shot says what the behaviour shown is — that is what makes it a demonstration and not a screenshot', wait: 1000 },
  ],
};

try {
  const { shots } = await recordReel({ reel, start: base, password: PASSWORD, say: (line) => console.log(line) });
  mkdirSync(evidence, { recursive: true });
  shots.forEach((shot, i) => writeFileSync(path.join(evidence, `shot-${i + 1}.png`), Buffer.from(shot.image.split(',')[1], 'base64')));
  writeFileSync(
    path.join(evidence, 'reel.json'),
    JSON.stringify({ title: reel.title, shots: shots.map((s, i) => ({ caption: s.caption, image: `shot-${i + 1}.png` })) }, null, 2),
  );
  console.log(`Wrote ${shots.length} shots and their reel to docs/cinema-evidence.`);
} finally {
  office.shutdown();
  rmSync(dir, { recursive: true, force: true });
}
