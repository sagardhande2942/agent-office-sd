import { existsSync, readFileSync } from 'node:fs';
import { homedir, hostname } from 'node:os';
import path from 'node:path';
import { runFloorHost } from './floor-join/reconnect.js';
import { JOIN_HELP, joinOptions, joinProject, savedJoinToken } from './floor-join/cli.js';
import type { FloorJoinProject } from '../shared/floor-join.js';


/**
 * `agent-office floor-host` — the office's side of the socket, run on the member's machine.
 *
 * One command, one connection, outbound only. It dials the office, pairs with a code the first time
 * (or with the token it kept), and then serves whatever floors the office asks it for out of `dir`s
 * on this machine. Nothing inbound: close the laptop or kill this and the floors go offline.
 *
 *   # first time, on the member's machine
 *   agent-office floor-host --office wss://bob.ngrok.app --code 5AVK-3NFP
 *
 *   # after that
 *   agent-office floor-host --office wss://bob.ngrok.app
 *
 * Floors arrive in `welcome` from the office's saved building. With --checkout, this authenticated
 * machine also registers its own project before that list is sent, so onboarding needs no restart.
 *
 * The token it keeps is written at 0600 in the host's own home. A machine that has never paired gets
 * its token in `welcome`, so nobody has to carry one between machines.
 */

const USAGE = `Usage: agent-office floor-host --office <url> [options]

Serve floors for an office on someone else's machine. Dials out to the office and holds the
connection; nothing here listens for anything.

  --office <url>       the office's address, e.g. wss://bob.ngrok.app or ws://localhost:4600
  --code <code>        pair for the first time, with the code from \`agent-office hosts pair\`
  --name <name>        what the office calls this machine (defaults to its hostname; first pairing only)
  --seats <n>          how many workers this machine will seat across its floors (default 0)
  --projects <dir>     where this machine keeps its checkouts (default ~/work, env AGENT_OFFICE_PROJECTS).
                       Told to the office so it can suggest a path when pointing a floor here
  --config <path>      where to keep the token (default ~/.agent-office-floor-host.json)
${JOIN_HELP}
  -h, --help           this

Disconnects and normal server shutdowns retry automatically for 10 minutes per outage. Ctrl+C cancels.

Once paired, the token is kept at 0600 and reused. The office sends the floors to serve; this machine
only has to have the checkouts they name. Revoke it with \`agent-office hosts revoke <id>\` on the
office and it is refused at the next connection.`;

interface HostConfig {
  office: string;
  token: string;
  hostId?: string;
  project?: FloorJoinProject;
}

function loadConfig(file: string): HostConfig | undefined {
  if (!existsSync(file)) return undefined;
  try {
    const saved = JSON.parse(readFileSync(file, 'utf8')) as Partial<HostConfig>;
    if (typeof saved.office !== 'string' || typeof saved.token !== 'string') return undefined;
    return { office: saved.office, token: saved.token, hostId: typeof saved.hostId === 'string' ? saved.hostId : undefined, project: saved.project };
  } catch {
    console.error(`agent-office floor-host: ${file} couldn't be read — pairing again`);
    return undefined;
  }
}

export async function floorHostCommand(argv: string[]): Promise<number> {
  let join: ReturnType<typeof joinOptions>;
  try { join = joinOptions(argv); argv = join.rest; } catch (err) { return fatal((err as Error).message); }
  let office = '';
  let code: string | undefined;
  let name: string | undefined = hostname();
  let configFile = path.join(homedir(), '.agent-office-floor-host.json');
  let seats = 0;
  // Where this machine keeps its checkouts. Reported to the office as a hint so that `hosts add-floor`
  // can suggest a path here without anyone having to know this machine's layout. Never used to open
  // anything on the office's behalf: the floor it names is still only opened if it is really there.
  let projects = process.env.AGENT_OFFICE_PROJECTS || path.join(homedir(), 'work');
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') {
      console.log(USAGE);
      return 0;
    } else if (a === '--office') {
      if (!argv[i + 1]) return fatal('--office needs a value');
      office = argv[++i];
    } else if (a === '--code') {
      if (!argv[i + 1]) return fatal('--code needs a value');
      code = argv[++i].trim().toUpperCase();
    } else if (a === '--name') {
      if (!argv[i + 1]) return fatal('--name needs a value');
      name = argv[++i];
    } else if (a === '--seats') {
      if (!argv[i + 1]) return fatal('--seats needs a number');
      seats = Number(argv[++i]);
      if (!Number.isInteger(seats) || seats < 0) return fatal('--seats takes a whole number, 0 or more');
    } else if (a === '--config') {
      if (!argv[i + 1]) return fatal('--config needs a value');
      configFile = path.resolve(argv[++i]);
    } else if (a === '--projects') {
      if (!argv[i + 1]) return fatal('--projects needs a value');
      projects = path.resolve(argv[++i]);
    } else return fatal(`unknown option ${a}`);
  }

  const saved = loadConfig(configFile);
  if (!office) office = saved?.office ?? '';
  if (!office) return fatal('--office is needed the first time, e.g. --office wss://bob.ngrok.app');
  if (join.recover && !code) return fatal('--recover needs the recovery code from Connect your floor');
  const token = savedJoinToken(saved, office, code, join.sameOffice, join.recover);
  if (!token && !code) return fatal('no token kept yet — pair first with --code, from `agent-office hosts pair` on the office');
  let project: FloorJoinProject | undefined;
  try { project = join.checkout ? joinProject(join.checkout, join.repo, join.name) : token && saved?.project ? joinProject(saved.project.dir, saved.project.repo, saved.project.name) : undefined; }
  catch (err) { return fatal((err as Error).message); }

  const url = office.replace(/^http/, 'ws').replace(/\/+$/, '') + '/floor-host';
  return runFloorHost(url, { token, code, name, configFile, seats, projects, project, owner: process.env.USER || process.env.USERNAME });
}

function fatal(msg: string): number {
  console.error(`agent-office floor-host: ${msg}`);
  return 1;
}
