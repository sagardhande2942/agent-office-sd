// The office's workers, for the agents working in it: what `office-workers` and the agent-office MCP
// server (bin/office-workers.js) get from the /office/workers endpoint on the loopback hook port, and
// how their requests are read. The endpoint itself is in server.ts, next to the board agents' queue.

import { writeFileSync } from 'node:fs';
import path from 'node:path';
import type { AgentEffort, AgentProvider, GhPull, QueueTask, WorkerInfo, WorktreeCleanup } from '../shared/protocol.js';
import { isAgentEffort, isAgentProvider } from '../shared/protocol.js';
import { DESK_BY_ID, STATION_AGENT } from '../shared/layout.js';
import { blockersOf } from '../shared/manager.js';
import { workerPr, type PullsView, type WorkerRow } from '../shared/status.js';
import { landedWork, notLeaving } from './leave-on-merge.js';

export type { PullsView, WorkerRow } from '../shared/status.js';

/** How long a task or activity line gets. */
const LINE = 160;

const clip = (s: string | undefined): string | undefined => {
  const t = s?.replace(/\s+/g, ' ').trim();
  return t ? (t.length > LINE ? `${t.slice(0, LINE - 1)}…` : t) : undefined;
};

/**
 * The row for one worker, as `office-workers list` and the floor report (`shared/manager.ts`) show it.
 * `at` is when the floor is being looked at: what a worker's blockers are worked out from (see
 * blockersOf), so a `list` and a `status` of the same moment agree.
 */
export function workerRow(w: WorkerInfo, view: PullsView, me?: string, at = Date.now()): WorkerRow {
  const seat = DESK_BY_ID.get(w.deskId);
  const pr = workerPr(w, view.pulls, view.tasks);
  const pull = pr && view.pulls.find((p) => p.number === pr.number);
  const landed = landedWork(w, view.pulls, view.tasks, view.pullsOf);
  const staying = landed ? notLeaving(w) : undefined;
  const task = clip(w.task ? `${w.task.name}: ${w.task.summary}` : w.prompt);
  const activity = clip(w.activity);
  return {
    id: w.id,
    ...(w.completion ? {completion:w.completion} : {}),
    name: w.name,
    kind: w.kind,
    ...(w.provider ? { provider: w.provider } : {}),
    ...(w.model ? { model: w.model } : {}),
    desk: seat?.label ?? w.deskId,
    status: w.status,
    ...(seat?.station ? { board: STATION_AGENT[seat.station].name } : {}),
    ...(w.meeting ? { meeting: true as const } : {}),
    ...(w.id === me ? { you: true as const } : {}),
    ...(task ? { task } : {}),
    ...(activity ? { activity } : {}),
    hiredBy: w.createdBy,
    hiredAt: new Date(w.createdAt).toISOString(),
    ...(w.viewers.length ? { viewers: [...w.viewers] } : {}),
    ...(w.worktree ? { worktree: { path: w.worktree.path, branch: w.worktree.branch, ...(w.lost ? { deleted: true as const } : {}) } } : {}),
    ...(w.repos?.length ? { repos: w.repos.map((r) => ({ name: r.name, branch: r.branch, ...(r.pr ? { pr: r.pr.number } : {}) })) } : {}),
    ...(pr ? { pr: { number: pr.number, state: pr.state, ...(pull ? { title: pull.title, url: pull.url } : {}) } } : {}),
    merged: !!landed,
    ...(staying ? { staying } : {}),
    ...(w.lastOutputAt ? { lastOutputAt: w.lastOutputAt } : {}),
    blockers: blockersOf(w, view.tasks.find((t) => t.workerId === w.id), at),
  };
}

/**
 * The worker `key` names: its id, or its name in any case (a shell's without the 🐚). A string when
 * there's no such worker, saying who there is.
 */
export function findWorker(workers: WorkerInfo[], key: string): WorkerInfo | string {
  const k = key.trim();
  if (!k) return 'Say which worker: its name or id';
  const byId = workers.find((w) => w.id === k);
  if (byId) return byId;
  const plain = (name: string) => name.replace(/\s*🐚$/u, '').trim().toLowerCase();
  const named = workers.filter((w) => plain(w.name) === plain(k));
  if (named.length === 1) return named[0];
  if (named.length > 1) return `More than one worker is called ${k}: use an id (${named.map((w) => w.id).join(', ')})`;
  return `No worker here is called ${k}${workers.length ? ` (there's ${workers.map((w) => w.name).join(', ')})` : ' (nobody is at a desk)'}`;
}

export const CLEANUP_CHOICES = ['auto', 'keep', 'worktree', 'all'] as const;
export type CleanupChoice = (typeof CLEANUP_CHOICES)[number];

/** What sending home was asked: these workers, or every one whose work landed. */
export type HomeRequest = { workers: string[]; merged: boolean; cleanup?: WorktreeCleanup };

/** A request to send workers home, read from its JSON body; a string says what's wrong with it. */
export function readHomeRequest(body: unknown): HomeRequest | string {
  const b = (body ?? {}) as { workers?: unknown; worker?: unknown; merged?: unknown; cleanup?: unknown };
  const list = b.workers ?? (b.worker === undefined ? [] : [b.worker]);
  if (!Array.isArray(list) || list.some((x) => typeof x !== 'string')) return 'workers is a list of worker names or ids';
  const workers = [...new Set((list as string[]).map((x) => x.trim()).filter(Boolean))];
  const merged = b.merged === true;
  if (!workers.length && !merged) return 'Say who: workers (names or ids), or merged: true for every worker whose pull request merged';
  if (workers.length && merged) return 'Give workers or merged: true, not both';
  if (workers.length > 64) return 'At most 64 workers at a time';
  if (b.cleanup !== undefined && !CLEANUP_CHOICES.includes(b.cleanup as CleanupChoice)) return `cleanup is one of ${CLEANUP_CHOICES.join(', ')}`;
  const cleanup = b.cleanup === undefined || b.cleanup === 'auto' ? undefined : (b.cleanup as WorktreeCleanup);
  return { workers, merged, ...(cleanup ? { cleanup } : {}) };
}

/** A request to hire a worker, read from its JSON body. */
export interface HireRequest {
  prompt: string;
  provider?: AgentProvider;
  model?: string;
  effort?: AgentEffort;
  /** Its own git worktree; undefined leaves it to the office (yes, in a git checkout). */
  worktree?: boolean;
  desk?: string;
  issue?: number;
}

export function readHireRequest(body: unknown, providers: AgentProvider[]): HireRequest | string {
  const b = (body ?? {}) as Record<string, unknown>;
  const prompt = typeof b.prompt === 'string' ? b.prompt.replace(/\r\n?/g, '\n').trim() : '';
  if (!prompt) return 'Give the new worker its task: prompt';
  if (prompt.length > 20000) return 'The prompt is over 20000 characters';
  if (b.provider !== undefined && (!isAgentProvider(b.provider) || !providers.includes(b.provider))) return `provider is one of ${providers.join(', ')}`;
  if (b.model !== undefined && (typeof b.model !== 'string' || !b.model.trim() || b.model.length > 200)) return 'model is a model name';
  if (b.effort !== undefined && !isAgentEffort(b.effort)) return 'effort is one of low, medium, high, xhigh, max';
  if (b.worktree !== undefined && typeof b.worktree !== 'boolean') return 'worktree is true or false';
  // Board kiosks and the meeting table seat their own: see station.prompt and meetings.ts.
  const seat = typeof b.desk === 'string' ? DESK_BY_ID.get(b.desk) : undefined;
  if (b.desk !== undefined && (!seat || seat.station || seat.room)) return "desk is a desk or bean bag's id, like desk-3";
  if (b.issue !== undefined && !(Number.isSafeInteger(b.issue) && (b.issue as number) > 0)) return 'issue is an issue number';
  return {
    prompt,
    ...(b.provider !== undefined ? { provider: b.provider as AgentProvider } : {}),
    ...(typeof b.model === 'string' ? { model: b.model.trim() } : {}),
    ...(b.effort !== undefined ? { effort: b.effort as AgentEffort } : {}),
    ...(typeof b.worktree === 'boolean' ? { worktree: b.worktree } : {}),
    ...(typeof b.desk === 'string' ? { desk: b.desk } : {}),
    ...(b.issue !== undefined ? { issue: b.issue as number } : {}),
  };
}

/**
 * A request to say which pull request is a worker's, read from its JSON body: its number, or its
 * URL (then `repo` is whose it is). With neither and unlink: true, the worker's is taken off.
 */
export interface PrRequest {
  /** Whose: the worker asking, when it doesn't say. */
  worker?: string;
  pr?: number;
  repo?: string;
}

export function readPrRequest(body: unknown): PrRequest | string {
  const b = (body ?? {}) as { worker?: unknown; pr?: unknown; unlink?: unknown };
  if (b.worker !== undefined && (typeof b.worker !== 'string' || !b.worker.trim())) return 'worker is a worker name or id';
  const who = typeof b.worker === 'string' ? { worker: b.worker.trim() } : {};
  if (b.unlink === true) return b.pr === undefined ? who : 'Give pr or unlink: true, not both';
  const text = typeof b.pr === 'string' ? b.pr.trim() : '';
  const url = /^https?:\/\/github\.com\/([\w.-]+\/[\w.-]+)\/pull\/(\d+)(?:[/?#].*)?$/i.exec(text);
  const n = typeof b.pr === 'number' ? b.pr : url ? Number(url[2]) : /^#?\d+$/.test(text) ? Number(text.replace('#', '')) : NaN;
  if (!Number.isSafeInteger(n) || n < 1) return "Say which pull request: pr, its number or its URL (or unlink: true to take the worker's off)";
  return { ...who, pr: n, ...(url ? { repo: url[1] } : {}) };
}

// --- The MCP server -------------------------------------------------------------------------------

/** The MCP server's name, which agents put before its tools (Claude Code: mcp__agent-office__send_home). */
export const MCP_NAME = 'agent-office';
/** What it needs from the worker's environment; Codex hands an MCP server only what it's told to. */
const MCP_ENV = ['AGENT_OFFICE_HOOK_URL', 'AGENT_OFFICE_WORKER_ID', 'AGENT_OFFICE_HOOK_TOKEN'];
/** Its tools that only look, which Claude Code workers may call without asking. */
export const MCP_READ_ONLY = [`mcp__${MCP_NAME}__list_workers`, `mcp__${MCP_NAME}__floor_status`];

/**
 * Writes Claude Code's --mcp-config file for the MCP server (bin/office-workers.js `mcp`, run by the
 * office's own node) and returns its path. The same for every worker: each one's identity is in its
 * environment, which Claude Code hands its MCP servers.
 */
export function writeClaudeMcpConfig(dataDir: string, script: string): string {
  const file = path.join(dataDir, 'agent-office-mcp.json');
  const config = { mcpServers: { [MCP_NAME]: { type: 'stdio', command: process.execPath, args: [script, 'mcp'] } } };
  writeFileSync(file, JSON.stringify(config, null, 2), { mode: 0o600 });
  return file;
}

/** Codex's -c overrides for the MCP server, with the office's variables passed on to it. */
export function codexMcpArgs(script: string, role?: 'candidate' | 'reviewer'): string[] {
  // TOML basic strings and arrays read JSON's.
  const key = `mcp_servers.${MCP_NAME}`;
  const env = role ? [...MCP_ENV, 'AGENT_OFFICE_PLAN_ROLE'] : MCP_ENV;
  const args = ['-c', `${key}.command=${JSON.stringify(process.execPath)}`, '-c', `${key}.args=${JSON.stringify([script, 'mcp'])}`, '-c', `${key}.env_vars=${JSON.stringify(env)}`];
  if (role) {
    const tools = ['plan_review_state', ...(role === 'candidate' ? ['submit_candidate_plan'] : ['request_plan_clarification', 'submit_plan_review'])];
    args.push('-c', `${key}.enabled_tools=${JSON.stringify(tools)}`);
    for (const tool of tools) args.push('-c', `${key}.tools.${tool}.approval_mode="approve"`);
  }
  return args;
}

/** OpenCode's `mcp` config entry for the MCP server; OpenCode hands it its environment. */
export function openCodeMcp(script: string): Record<string, unknown> {
  return { [MCP_NAME]: { type: 'local', command: [process.execPath, script, 'mcp'], enabled: true } };
}
