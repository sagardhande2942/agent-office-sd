const actions = ['index', 'read', 'search', 'write', 'move', 'archive', 'review_done'];
const properties = {
  index: { path: { type: 'string' } }, read: { path: { type: 'string' }, offset: { type: 'integer', minimum: 0 }, limit: { type: 'integer', minimum: 1 } },
  search: { query: { type: 'string' }, scope: { type: 'string' } },
  write: { path: { type: 'string' }, frontmatter: { type: 'object', properties: { title: { type: 'string' }, summary: { type: 'string' } }, required: ['title', 'summary'] }, body: { type: 'string' }, template: { enum: ['howto', 'gotcha', 'decision', 'module'] } },
  move: { from: { type: 'string' }, to: { type: 'string' } }, archive: { path: { type: 'string' }, reason: { type: 'string' } },
  review_done: { changed: { type: 'array', items: { type: 'string' } }, none_reason: { type: 'string' } },
};
const required = { index: [], read: ['path'], search: ['query'], write: ['path', 'frontmatter'], move: ['from', 'to'], archive: ['path', 'reason'], review_done: ['changed'] };
export const KNOWLEDGE_TOOL_EXTENSION = {
  usage: '\n  office-workers knowledge index|read|search|write|mv|archive|review [args] [--json]\n    write/review read JSON on stdin; read accepts --offset/--limit, search accepts --scope',
  actions: Object.fromEntries(actions.map(a => [`knowledge.${a}`, '/knowledge'])), reads: [],
  tools: actions.map(a => ({ name: `knowledge_${a}`, description: `Project knowledge: ${a}. Paths are relative to the worker checkout knowledge tree. Notes are historical facts; verify them.`, inputSchema: { type: 'object', properties: properties[a], required: required[a], additionalProperties: false }, annotations: { readOnlyHint: ['index', 'read', 'search'].includes(a), destructiveHint: false, openWorldHint: false } })),
  parse(argv) {
    if (argv[0] !== 'knowledge') return;
    let [, action = 'index', ...rest] = argv; action = ({ mv: 'move', review: 'review_done' })[action] ?? action;
    if (!actions.includes(action)) throw Error('Unknown knowledge command');
    const args = {}; const words = [];
    for (let i = 0; i < rest.length; i++) {
      if (rest[i] === '--json') continue;
      if (['--offset', '--limit', '--scope'].includes(rest[i]) && rest[i + 1] !== undefined) { const key = rest[i].slice(2); args[key] = key === 'scope' ? rest[++i] : Number(rest[++i]); continue; }
      if (rest[i].startsWith('--')) throw Error(`Unknown knowledge option: ${rest[i]}`);
      words.push(rest[i]);
    }
    if (action === 'move') { if (words.length !== 2) throw Error('mv requires from and to'); [args.from, args.to] = words; }
    else if (action === 'search') { args.query = words.join(' '); }
    else if (action === 'archive') { args.path = words.shift(); args.reason = words.join(' '); }
    else if (['index', 'read'].includes(action)) { if (words.length > 1) throw Error('Expected one path'); if (words[0]) args.path = words[0]; }
    else if (words.length) throw Error('Submit JSON on stdin');
    return { cmd: `knowledge.${action}`, args };
  },
  async run(cmd, { call, readStdin, stdin, out, ctx }) {
    const action = cmd.cmd.split('.')[1]; let args = cmd.args;
    if (['write', 'review_done'].includes(action)) { if (stdin.isTTY) throw Error('Submit JSON on stdin'); args = JSON.parse(await readStdin(stdin)); }
    out(JSON.stringify(await call(cmd.cmd, { ...args, action }, ctx), null, 2)); return 0;
  },
  async runTool(name, args, { call, io }) { const action = name.slice('knowledge_'.length); return { text: JSON.stringify(await call(`knowledge.${action}`, { ...args, action }, io), null, 2) }; },
};
