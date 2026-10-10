#!/usr/bin/env node
// The command a worker runs to stage a demonstration of what it just shipped, against the actual build:
//
//   npm run build && npm run reel:record -- --reel reel.json --out reel-staged.json
//   office-workers cinema add < reel-staged.json
//
// It drives a real browser over the production bundle (see src/server/cinema/record.ts) and screenshots
// it after each step in the reel, so the pictures in the screening room are the feature behaving rather
// than a drawing of it. With no `--start` it brings up an office of its own for the recording; with one
// it records against the office you name.
//
//   --reel <file>    the reel to walk (default reel.json)
//   --out <file>     where to write the recorded reel (default reel-staged.json)
//   --start <url>    an office that is already running, to record against instead of starting one
//   --login <pass>   that office's password
//   --keep           keep the office this started, and its folder

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { flag, readReelFile, recordReel } from '../src/server/cinema/record.ts';

const args = process.argv.slice(2);
const reelFile = flag(args, 'reel', 'reel.json');
const out = flag(args, 'out', 'reel-staged.json');
const start = flag(args, 'start', undefined);
const password = flag(args, 'login', 'record-password');
const keep = args.includes('--keep');

let text;
try {
  text = readFileSync(reelFile, 'utf8');
} catch {
  console.error(`record-reel: no ${reelFile}. Write one first: {"title": …, "shots": [{"caption": …}]}.`);
  process.exit(2);
}
const reel = readReelFile(text);
if (typeof reel === 'string') {
  console.error(`record-reel: ${reel}`);
  process.exit(2);
}

try {
  const { shots, base } = await recordReel({ reel, ...(start ? { start } : {}), password, say: (line) => console.log(line) });
  writeFileSync(out, JSON.stringify({ title: reel.title, ...(reel.pr ? { pr: reel.pr } : {}), shots }, null, 2));
  console.log(`\nWrote ${out}: ${shots.length} captioned shot(s) of the build at ${base}.`);
  console.log(`Now put it on the screening room:  office-workers cinema add < ${path.basename(out)}`);
} catch (err) {
  console.error(`record-reel: ${err.message}`);
  process.exitCode = 1;
}
if (keep) console.error('(--keep: the office this started is still running.)');
