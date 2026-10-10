import { teamTargetError } from '../master-workers/role.js';
import type http from 'node:http';
import { notLeaving } from '../leave-on-merge.js';
import { findWorker, readHireRequest, readHomeRequest, readPrRequest, readReelRequest, workerRow, type PullsView } from '../office-workers.js';
import { gh } from '../github.js';
import type { Floor } from '../floor.js';
import { DESK_BY_ID, nextFreeSeat } from '../../shared/layout.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { Ctx } from '../office/context.js';
import { str } from '../office/input.js';
import { readBody, send } from '../http/util.js';
import { REEL_BODY_BYTES } from '../../shared/cinema.js';
import { cinemaChanged } from '../ws/handlers/cinema.js';

/**
 * Pull request `n` on a floor, for a worker to have as its own: one that's open, or merged and still
 * on the floor's list. A string says why it can't be.
 */
async function pullOf(floor: Floor, n: number, repo?: string): Promise<{ number: number; url: string } | string> {
  const here = floor.def.repo;
  if (repo && here && repo.toLowerCase() !== here.toLowerCase()) return `That pull request is in ${repo}, and this floor is ${here}`;
  const listed = floor.forge.pulls.items.find((p) => p.number === n);
  let pr: { url: string; state: string } | undefined = listed;
  if (!pr) {
    try {
      pr = JSON.parse(await gh(['pr', 'view', String(n), '--json', 'url,state'], floor.dir)) as { url: string; state: string };
    } catch (err) {
      return `No pull request #${n} here: ${(err as Error).message}`;
    }
  }
  if (pr.state === 'CLOSED') return `PR #${n} was closed without merging`;
  // The office follows the open ones and the last ones merged: an older one would look open for good.
  if (!listed && pr.state === 'MERGED') return `PR #${n} merged too long ago for the office to follow: send the worker home by name instead`;
  return { number: n, url: pr.url };
}

/**
 * The floor's workers, for any worker on it (see office-workers.ts, and bin/office-workers.js, the
 * command and MCP server that call it): GET lists them, POST hires one, POST /home sends some home
 * (its worktree and branch go too, unless they hold work), POST /tell types a prompt to one, POST /pr
 * says which pull request is one's (for one the office couldn't tell by itself). The
 * worker's own hook token says who's asking, and the floor hears who did what, as from anyone.
 */
export async function officeWorkers(ctx: Ctx, req: http.IncomingMessage, res: http.ServerResponse, url: URL) {
  const workerId = url.searchParams.get('worker') ?? '';
  const token = (req.headers.authorization ?? '').replace(/^Bearer\s+/i, '');
  const floor = ctx.workerFloor(workerId);
  const me = floor?.workers.authenticate(workerId, token);
  if (!floor || !me) return send(res, 401, { error: 'Send your own AGENT_OFFICE_WORKER_ID as ?worker= and AGENT_OFFICE_HOOK_TOKEN as the bearer token' });
  const who = me.name;
  const view: PullsView = { pulls: floor.forge.pulls.items, tasks: floor.queue.state().tasks, pullsOf: (id) => ctx.anyFloor(id)?.forge.pulls.items };
  const row = (id: string) => {
    const w = floor.workers.get(id);
    return w && workerRow(w, view, me.id);
  };
  const action = url.pathname.slice('/office/workers'.length);
  if (req.method === 'GET' && !action) {
    const list = floor.workers.list();
    const free = nextFreeSeat((id) => floor.workers.deskOccupied(id), floor.plan.wing);
    return send(res, 200, {
      floor: { id: floor.id, name: floor.def.name, repo: floor.def.repo, branch: floor.project.branch },
      you: me.id,
      leaveOnMerge: ctx.leaveOnMerge.on,
      providers: floor.project.agentProviders,
      defaultProvider: floor.workers.officeDefault.provider,
      coordination: 'Use office-workers request for tracked messages, inbox between tasks, reply <request-id>, and ack <reply-id>. Messages do not interrupt terminals.',
      freeDesk: free?.id ?? null,
      ...(ctx.ledger.hiringPaused ? { hiringPaused: ctx.ledger.hiringPaused } : {}),
      workers: list.map((w) => workerRow(w, view, me.id)),
    });
  }
  // What's in the screening room, for `office-workers cinema list`: the reels and what is on the
  // screen. Its own GET, beside the roster's, rather than a read of a POST-only endpoint.
  if (req.method === 'GET' && action === '/cinema') {
    const local = ctx.asLocal(floor);
    return local
      ? send(res, 200, local.cinema.state())
      : send(res, 403, { error: floor.refuses('the screening room') });
  }
  if (req.method !== 'POST' || !['', '/home', '/tell', '/pr', '/cinema', '/cinema/remove'].includes(action))
    return send(res, 405, { error: 'GET /office/workers or /office/workers/cinema, or POST to /office/workers, /office/workers/home, /office/workers/tell, /office/workers/pr, /office/workers/cinema or /office/workers/cinema/remove' });
  let body: unknown;
  try {
    // A reel's pictures are base64 in the body, so its budget is bigger than the 1 MB default and is
    // REEL_BODY_BYTES: over it the request is refused with a reason rather than cut off mid-stream.
    body = JSON.parse((await readBody(req, action.startsWith('/cinema') ? REEL_BODY_BYTES : 1024 * 1024)) || '{}');
  } catch (err) {
    if ((err as Error).message === 'too large') return send(res, 413, { error: 'That reel is too big to send: record fewer or smaller shots' });
    return send(res, 400, { error: 'Send JSON' });
  }

  if (action === '/home') {
    const ask = readHomeRequest(body);
    if (typeof ask === 'string') return send(res, 400, { error: ask });
    if (ask.cleanup === 'all' && DESK_BY_ID.get(me.deskId)?.station) return send(res, 403, { error: 'Ask a person before deleting work that is not on GitHub' });
    type Outcome = { worker: string; id?: string; went?: boolean; note?: string; error?: string; skipped?: string };
    const results: Outcome[] = [];
    const going: { w: WorkerInfo; why?: string }[] = [];
    if (ask.merged) {
      for (const w of floor.workers.list()) {
        const landed = floor.landed(w);
        if (!landed) continue;
        const why = landed.prs?.length ? `its pull requests merged (${landed.prs.join(', ')})` : `PR #${landed.pr} merged`;
        const staying = teamTargetError(w) ?? (w.id === me.id ? "that's you" : notLeaving(w));
        if (staying) results.push({ worker: w.name, id: w.id, skipped: `${why}, but it's ${staying}` });
        else going.push({ w, why });
      }
    } else {
      for (const key of ask.workers) {
        const w = findWorker(floor.workers.list(), key);
        if (typeof w === 'string') results.push({ worker: key, error: w });
        else if (teamTargetError(w)) results.push({worker:w.name,id:w.id,error:teamTargetError(w)});
        else if (w.id === me.id) results.push({ worker: w.name, id: w.id, error: "That's you: someone else has to send you home" });
        else if (!going.some((g) => g.w === w)) going.push({ w });
      }
    }
    // One at a time: git takes a lock on the repository's refs to delete a branch.
    for (const { w, why } of going) {
      if (floor.workers.get(w.id) !== w) {
        results.push({ worker: w.name, id: w.id, skipped: 'it had already gone' });
        continue;
      }
      ctx.toastFloor(floor, why ? `🏠 ${who} sent ${w.name} home: ${why}` : `${who} sent ${w.name} home`);
      const { note, error } = await floor.sendHome(w.id, ask.cleanup);
      if (note) ctx.toastFloor(floor, note);
      if (error) ctx.toastFloor(floor, error, 'warn');
      results.push({ worker: w.name, id: w.id, went: true, ...(note ? { note } : {}), ...(error ? { error } : {}) });
    }
    return send(res, 200, { results });
  }

  if (action === '/tell') {
    const b = (body ?? {}) as { worker?: unknown; prompt?: unknown };
    const w = findWorker(floor.workers.list(), str(b.worker, 64));
    if (typeof w === 'string') return send(res, 404, { error: w });
    const managed=teamTargetError(w);if(managed)return send(res,403,{error:managed});
    if (w.id === me.id) return send(res, 400, { error: "That's you" });
    // A shell would run it as a command, in someone's terminal.
    if (w.kind !== 'agent') return send(res, 400, { error: `${w.name} is a shell, not an agent` });
    const text = str(b.prompt, 20000).replace(/\r\n?/g, '\n').trim();
    if (!text) return send(res, 400, { error: 'Say what to tell it: prompt' });
    let err = floor.workers.prompt(w.id, text, who);
    // Stopped or asleep: it wakes up with this as its next message.
    if (err === 'Worker is not running') err = floor.workers.resume(w.id, text);
    if (err) return send(res, 400, { error: err });
    return send(res, 200, { ok: true, worker: row(w.id) });
  }

  if (action === '/pr') {
    const ask = readPrRequest(body);
    if (typeof ask === 'string') return send(res, 400, { error: ask });
    const w = ask.worker ? findWorker(floor.workers.list(), ask.worker) : me;
    if (typeof w === 'string') return send(res, 404, { error: w });
    if (w.kind !== 'agent') return send(res, 400, { error: `${w.name} is a shell, not an agent` });
    const managed=teamTargetError(w);if(managed)return send(res,403,{error:managed});
    const pr = ask.pr === undefined ? undefined : await pullOf(floor, ask.pr, ask.repo);
    if (typeof pr === 'string') return send(res, 400, { error: pr });
    const err = floor.workers.linkPr(w.id, pr);
    if (err) return send(res, 404, { error: err });
    const whose = w.id === me.id ? 'its own' : `${w.name}'s`;
    ctx.toastFloor(floor, pr ? `${who} said PR #${pr.number} is ${whose}` : `${who} said ${w.id === me.id ? 'it has' : `${w.name} has`} no pull request`);
    return send(res, 200, { ok: true, worker: row(w.id) });
  }

  if (action === '/cinema/remove') {
    const local = ctx.asLocal(floor);
    if (!local) return send(res, 403, { error: floor.refuses('the screening room') });
    const id = str((body as { reel?: unknown }).reel, 32);
    if (!/^[a-z0-9]{12}$/.test(id)) return send(res, 400, { error: 'Say which reel to remove: its id, from `office-workers cinema list`' });
    if (!local.cinema.remove(id, who)) return send(res, 404, { error: 'No such reel in the screening room' });
    cinemaChanged(ctx, local);
    ctx.toastFloor(local, `🗑️ ${who} took a reel off the screening room`);
    return send(res, 200, { ok: true, reels: local.cinema.state().reels });
  }

  if (action === '/cinema') {
    // A worker recording a demonstration of what it shipped: the shots are pictures of the build, so
    // this is the screening room's own directory and only a floor in this process has one.
    const local = ctx.asLocal(floor);
    if (!local) return send(res, 403, { error: floor.refuses('the screening room') });
    const ask = readReelRequest(body);
    if (typeof ask === 'string') return send(res, 400, { error: ask });
    let reel;
    try {
      reel = local.cinema.add({ title: ask.title, ...(ask.pr ? { pr: ask.pr } : {}), by: who, shots: ask.shots.map(({ caption, width, height }) => ({ caption, width, height })) }, ask.shots.map((s) => s.png));
    } catch (err) {
      return send(res, 500, { error: (err as Error).message });
    }
    cinemaChanged(ctx, local);
    ctx.toastFloor(local, `🎬 ${who} put “${reel.title}” on the screening room (${reel.shots.length} shot${reel.shots.length === 1 ? '' : 's'})`);
    return send(res, 200, { ok: true, reel });
  }

  const ask = readHireRequest(body, floor.project.agentProviders);
  if (typeof ask === 'string') return send(res, 400, { error: ask });
  const desk = ask.desk ?? nextFreeSeat((id) => floor.workers.deskOccupied(id), floor.plan.wing)?.id;
  if (!desk) return send(res, 409, { error: 'Every desk and bean bag is taken: send someone home first' });
  // A model or effort is the office's default worker's unless it says whose.
  const provider = ask.provider ?? (ask.model || ask.effort ? floor.workers.officeDefault.provider : undefined);
  const worktree = ask.worktree ?? !!floor.project.branch;
  // Its worktree starts from what's on GitHub now, like one hired from a desk.
  if (worktree) await floor.workers.fetchBase();
  if (!ctx.floors.has(floor.id)) return send(res, 410, { error: 'This floor closed' });
  // It runs as whoever the asking worker runs as.
  const owner = floor.workers.ownerOf(me.id);
  const r = floor.workers.spawn(desk, who, ask.prompt, worktree, 'agent', provider, ask.model, ask.effort, undefined, owner);
  if (typeof r === 'string') return send(res, 400, { error: r });
  ctx.toastFloor(floor, `${who} hired ${r.name}${ask.issue ? ` for issue #${ask.issue}` : ' with a task'}`);
  if (ask.issue) {
    const n = ask.issue;
    floor.queue.dropIssue(n);
    const as = owner ? ctx.signins.ghAs(owner) : undefined;
    if (typeof as === 'string') ctx.toastFloor(floor, `Couldn't assign issue #${n} on GitHub: ${as}`, 'warn');
    else void floor.forge.claim(n, as).then((e) => e && ctx.toastFloor(floor, `Couldn't assign issue #${n} on GitHub: ${e}`, 'warn'));
  }
  send(res, 200, { ok: true, worker: row(r.id) });
}
