// Handoffs move an unfinished task between workers as a structured packet. Every action posts to
// the office's authenticated /office/workers/handoff endpoint (src/server/hooks/worker-features.ts
// routes it): the server owns source identity, floor membership, revision and acceptance rules, so
// this CLI only shapes the request and explains the schema. Delivery through the tracked inbox is
// not acceptance — only the named recipient's accept action is.

/** Every action the handoff endpoint understands. */
const ACTIONS = ['list', 'read', 'prefill', 'create', 'accept', 'cancel'];
const CHECK_STATUSES = ['passed', 'failed', 'skipped'];
const CONTEXT_KEYS = ['branch', 'commit', 'pr', 'worktree'];
const CHECK_KEYS = ['name', 'status', 'evidence'];
/** The create schema, in the order a packet reads: who, which task, what's done, what's next. */
const CREATE_KEYS = ['key', 'recipient', 'revision', 'taskId', 'goal', 'completedWork', 'nextSteps', 'files', 'filesNote', 'checks', 'questions', 'questionsNote', 'context'];

const str = { type: 'string', minLength: 1 };
/** Why each create field exists, so a worker reading the tool schema can fill it correctly. */
const CREATE_DESCRIPTIONS = {
  key: 'Idempotency key (a UUID you invent): retrying with the same key returns the same handoff instead of a duplicate.',
  recipient: 'The same-floor worker, by name or id, that must explicitly accept. Delivery or human viewing is not acceptance.',
  revision: 'Your current completion revision (from office-workers completion). Stale revisions are rejected.',
  taskId: 'The task the packet hands over, when your floor tracks one.',
  goal: "The task's goal, in your words.",
  completedWork: 'What is already done and verified, as you reported it.',
  nextSteps: 'What the continuation worker should do next.',
  files: 'Changed file paths. Omit to prefill from your completion; an empty array requires filesNote.',
  filesNote: 'Required when files is empty: why there are no changed files (e.g. docs-only, nothing committed yet).',
  checks: 'Optional checks with real evidence: each {name, status: passed|failed|skipped, evidence}. Prefilled from your completion; evidence is always worker-reported.',
  questions: 'Unresolved questions for the continuation worker. An empty array requires questionsNote.',
  questionsNote: 'Required when questions is empty: why nothing is unresolved.',
  context: 'Optional branch/commit/pr/worktree pointers, prefilled from your completion; the full packet stays in your worktree.',
};
const object = (properties, required = Object.keys(properties)) => ({ type: 'object', properties, required, additionalProperties: false });
const checkSchema = { type: 'object', properties: { name: str, status: { type: 'string', enum: CHECK_STATUSES }, evidence: str }, required: CHECK_KEYS, additionalProperties: false };
const createSchema = {
  type: 'object',
  properties: Object.fromEntries(CREATE_KEYS.map((k) => [k,
    k === 'revision' ? { type: 'integer', minimum: 0, description: CREATE_DESCRIPTIONS.revision }
    : k === 'files' || k === 'questions' ? { type: 'array', items: str, description: CREATE_DESCRIPTIONS[k] }
    : k === 'checks' ? { type: 'array', items: checkSchema, minItems: 1, maxItems: 30, description: CREATE_DESCRIPTIONS.checks }
    : k === 'context' ? { type: 'object', properties: Object.fromEntries(CONTEXT_KEYS.map((c) => [c, str])), additionalProperties: false, description: CREATE_DESCRIPTIONS.context }
    : { ...str, description: CREATE_DESCRIPTIONS[k] }])),
  required: ['key', 'recipient', 'revision', 'completedWork', 'nextSteps', 'questions'],
  additionalProperties: false,
};

/** Why the handoff create schema reads the way it does, in error messages. */
const CREATE_STDIN = '{key, recipient, revision, completedWork, nextSteps, questions, taskId?, goal?, files?, filesNote?, checks?, questionsNote?, context?}';

export const HANDOFF_TOOL_EXTENSION = {
  usage: `\n  office-workers handoff list [--json]        every handoff packet on this floor: source,
                                                recipient, state (offered/accepted/cancelled)
  office-workers handoff read <id> [--json]   one packet in full: goal, completed work, next
                                                steps, file/check evidence, open questions
  office-workers handoff prefill [--json]     draft metadata from your task and completion
                                                (task id/revision, checks, files, branch/PR)
  office-workers handoff create < packet.json offer your task to a named worker; the packet on
                                                stdin is one JSON object:
                                                  {key, recipient, revision, completedWork,
                                                   nextSteps, questions, taskId?, goal?,
                                                   files?, filesNote?, checks?,
                                                   questionsNote?, context?}
                                                key (idempotency) and revision (your current
                                                completion revision) are required; an empty
                                                files needs filesNote, an empty questions
                                                needs questionsNote; checks need meaningful
                                                evidence. All evidence is worker-reported
  office-workers handoff accept <id>          explicitly accept a packet offered to you: you
                                                become the continuation owner. It moves no files
                                                and replaces no task
  office-workers handoff cancel <id>          withdraw a packet you offered`,
  // One POST endpoint; the body names the action, the way the knowledge tools work.
  actions: Object.fromEntries(ACTIONS.map((a) => [`handoff.${a}`, '/handoff'])),
  reads: [],
  tools: [
    { name: 'handoff_list', description: "List this floor's handoff packets: source, recipient, offered/accepted/cancelled state with timestamps, and the delivery receipt.", inputSchema: object({}), annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
    { name: 'handoff_read', description: 'Read one handoff packet in full: task id/revision and goal, completed work, next steps, changed files or their note, checks with passed/failed/skipped evidence, unresolved questions or their note, branch/commit/PR/worktree context and receipt state.', inputSchema: object({ id: str }), annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
    { name: 'handoff_prefill', description: 'Prefill a handoff draft from your current task and completion metadata (task id/revision, goal, checks, files, branch/commit/PR context). Review and adapt it before handoff_create: every field it returns is worker-reported evidence, not verified fact.', inputSchema: object({}), annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false } },
    { name: 'handoff_create', description: 'Offer your unfinished task to a named same-floor worker as a structured packet. Requires an idempotency key and your current completion revision; source identity is server-owned. Omitted files/checks/context prefill from your completion; empty files needs filesNote, empty questions needs questionsNote, checks need meaningful evidence. The inbox delivery is not acceptance: only the named recipient can accept.', inputSchema: createSchema, annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: 'handoff_accept', description: 'Explicitly accept a handoff offered to you: you become the continuation owner and the full packet becomes yours to continue. Acceptance moves no files, resets no worktree, replaces no active task and does not complete the source task. Only the named recipient can accept; retries do not accept twice.', inputSchema: object({ id: str }), annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false } },
    { name: 'handoff_cancel', description: 'Withdraw a handoff you offered while the office still has it as offered. The server decides by state and ownership; a cancelled packet stays visible with its timestamp.', inputSchema: object({ id: str }), annotations: { destructiveHint: false, idempotentHint: true, openWorldHint: false } },
  ],
  parse(argv) {
    if (argv[0] !== 'handoff') return;
    let [, action = 'list', ...rest] = argv;
    if (!ACTIONS.includes(action)) throw Error('Unknown handoff action: use list, read, prefill, create, accept or cancel');
    // create reads its packet on stdin; --json only selects output, which is always JSON anyway.
    if (action === 'create') {
      if (rest.some((arg) => arg !== '--json')) throw Error(`Submit the packet JSON on stdin (office-workers handoff create < packet.json), shaped like ${CREATE_STDIN}`);
      return { cmd: 'handoff.create', args: {} };
    }
    const words = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--json') continue;
      if (rest[i].startsWith('--')) throw Error(`Unknown handoff option: ${rest[i]}`);
      words.push(rest[i]);
    }
    const args = {};
    if (['read', 'accept', 'cancel'].includes(action)) {
      if (words.length !== 1) throw Error(`handoff ${action} takes one handoff id`);
      args.id = words[0];
    } else if (words.length) throw Error(`handoff ${action} takes no arguments`);
    return { cmd: `handoff.${action}`, args };
  },
  async run(cmd, { call, readStdin, stdin, out, ctx }) {
    const action = cmd.cmd.slice('handoff.'.length);
    let args = cmd.args ?? {};
    if (action === 'create') {
      if (stdin.isTTY) throw Error(`Submit the packet JSON on stdin: office-workers handoff create < packet.json (${CREATE_STDIN})`);
      let draft;
      try { draft = JSON.parse(await readStdin(stdin)); } catch { throw Error('handoff create requires valid JSON on stdin'); }
      args = readCreatePacket(draft);
    } else if (['read', 'accept', 'cancel'].includes(action)) args = requireId(args);
    out(JSON.stringify(await call(cmd.cmd, { ...args, action }, ctx), null, 2));
    return 0;
  },
  async runTool(name, args, { call, io }) {
    const action = name.slice('handoff_'.length);
    // The server still validates everything; this only fails fast with the schema's own words.
    const body = action === 'create' ? readCreatePacket(args) : ['read', 'accept', 'cancel'].includes(action) ? requireId(args) : {};
    return { text: JSON.stringify(await call(`handoff.${action}`, { ...body, action }, io), null, 2) };
  },
};

/** The packet id every read/accept/cancel carries. */
function requireId(args) {
  const id = args && typeof args === 'object' ? args.id : undefined;
  if (typeof id !== 'string' || !id.trim()) throw new Error('handoff: id must be the id of a handoff packet (office-workers handoff list)');
  return { id };
}

/** A create mistake, in words that name the fix. */
function fail(why) { throw new Error(`handoff create: ${why}`); }

function nonEmptyString(value, field) {
  if (typeof value !== 'string' || !value.trim()) fail(`${field} must be a non-empty string`);
  return value;
}

function optionalString(value, field) {
  if (value === undefined) return undefined;
  if (typeof value !== 'string') fail(`${field} must be a string`);
  return value;
}

function stringList(value, field) {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) fail(`${field} must be an array of strings`);
  return value.map((item, i) => nonEmptyString(item, `${field}[${i}]`));
}

function rejectUnknownKeys(object, keys, where) {
  const unknown = Object.keys(object).filter((k) => !keys.includes(k));
  if (unknown.length) fail(`${where ? `${where} has unknown field(s)` : 'unknown field(s)'}: ${unknown.join(', ')} (allowed: ${keys.join(', ')})`);
}

function readChecks(checks) {
  // The server accepts 1-30 checks: an empty list is not "no checks", it is "skipped with a reason".
  if (!Array.isArray(checks) || !checks.length) fail('checks must be 1-30 checks, each {name, status: passed|failed|skipped, evidence}; to report none, use one skipped check with its reason');
  if (checks.length > 30) fail('checks holds at most 30 checks');
  return checks.map((check, i) => {
    if (!check || typeof check !== 'object' || Array.isArray(check)) fail(`checks[${i}] must be an object with name, status and evidence`);
    rejectUnknownKeys(check, CHECK_KEYS, `checks[${i}]`);
    nonEmptyString(check.name, `checks[${i}].name`);
    if (!CHECK_STATUSES.includes(check.status)) fail(`checks[${i}].status must be passed, failed or skipped (got ${JSON.stringify(check.status)})`);
    nonEmptyString(check.evidence, `checks[${i}].evidence — real output or why it was skipped; evidence is always worker-reported`);
    return { name: check.name, status: check.status, evidence: check.evidence };
  });
}

function readContext(context) {
  if (context === undefined) return undefined;
  if (!context || typeof context !== 'object' || Array.isArray(context)) fail('context must be an object of branch/commit/pr/worktree strings');
  rejectUnknownKeys(context, CONTEXT_KEYS, 'context');
  const out = {};
  for (const key of CONTEXT_KEYS) if (context[key] !== undefined) out[key] = nonEmptyString(context[key], `context.${key}`);
  // The same shapes the server enforces, so a bad pointer is caught here instead of on the floor.
  if (out.commit && !/^[a-f\d]{7,40}$/i.test(out.commit)) fail('context.commit must be a git hash (7-40 hex characters)');
  if (out.pr && !/^https?:\/\//.test(out.pr)) fail('context.pr must be an http(s) URL');
  return Object.keys(out).length ? out : undefined;
}

/**
 * Validates one create packet and returns it with only the schema's own fields, so a typo or a
 * stray field never reaches the floor. The server re-checks all of it against the real
 * completion revision, floor roster and storage; this is the fast, honest error before the call.
 */
export function readCreatePacket(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) fail('submit a JSON object on stdin');
  rejectUnknownKeys(input, CREATE_KEYS);
  nonEmptyString(input.key, 'key (your idempotency key; retrying with it returns the same handoff)');
  nonEmptyString(input.recipient, 'recipient (the same-floor worker that must explicitly accept)');
  if (!Number.isInteger(input.revision) || input.revision < 0) fail('revision must be your current completion revision: a non-negative integer from office-workers completion');
  const packet = { key: input.key, recipient: input.recipient, revision: input.revision };
  const taskId = optionalString(input.taskId, 'taskId');
  if (taskId !== undefined) { if (!taskId.trim()) fail('taskId must be a non-empty string'); packet.taskId = taskId; }
  const goal = optionalString(input.goal, 'goal');
  if (goal !== undefined) packet.goal = goal;
  packet.completedWork = nonEmptyString(input.completedWork, 'completedWork (what is already done, as you reported it)');
  packet.nextSteps = nonEmptyString(input.nextSteps, 'nextSteps (what the continuation worker should do next)');
  // files omitted means "prefill from my completion"; an explicit empty list must say why.
  const files = stringList(input.files, 'files');
  if (files !== undefined) {
    const note = optionalString(input.filesNote, 'filesNote');
    if (!files.length && !(note ?? '').trim()) fail('files is empty: add filesNote explaining why (or omit files entirely to prefill from your completion)');
    packet.files = files;
    if (note !== undefined) packet.filesNote = note;
  } else if (input.filesNote !== undefined) packet.filesNote = optionalString(input.filesNote, 'filesNote');
  if (input.checks !== undefined) packet.checks = readChecks(input.checks);
  // questions is required: an explicit empty list keeps the packet inspectable, with its note.
  const questions = stringList(input.questions, 'questions');
  if (questions === undefined) fail('questions is required: list unresolved questions, or an empty array plus questionsNote when there are none');
  const questionsNote = optionalString(input.questionsNote, 'questionsNote');
  if (!questions.length && !(questionsNote ?? '').trim()) fail('questions is empty: add questionsNote explaining why there are none');
  packet.questions = questions;
  if (questionsNote !== undefined) packet.questionsNote = questionsNote;
  const context = readContext(input.context);
  if (context !== undefined) packet.context = context;
  return packet;
}
