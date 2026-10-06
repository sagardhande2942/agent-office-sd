#!/usr/bin/env node
// A role-scoped plan tool bridge for coding agents without an office MCP connection.
import { realpathSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { handleMcp, toolsForRole } from './office-workers.js';

export async function main(argv, io = {}) {
  const env = io.env ?? process.env;
  const out = io.out ?? (s => console.log(s));
  const err = io.err ?? (s => console.error(s));
  try {
    if (!['candidate', 'reviewer'].includes(env.AGENT_OFFICE_PLAN_ROLE)) throw Error('This command is only for locked planning participants');
    const tools = toolsForRole(env.AGENT_OFFICE_PLAN_ROLE);
    if (argv.length === 1 && argv[0] === '--help') {
      out(JSON.stringify(tools, null, 2)); return 0;
    }
    if (argv.length !== 1 || !tools.some(t => t.name === argv[0])) throw Error('Choose a tool from: ' + tools.map(t => t.name).join(', '));
    let args = {};
    if (argv[0] !== 'plan_review_state') {
      const read = io.read ?? (async () => {
        let body = '';
        for await (const chunk of process.stdin) {
          body += chunk;
          if (body.length > 100_000) throw Error('Plan tool input exceeds 100,000 characters');
        }
        return body;
      });
      const body = await read();
      if (body.length > 100_000) throw Error('Plan tool input exceeds 100,000 characters');
      args = JSON.parse(body);
    }
    const response = await handleMcp({jsonrpc:'2.0',id:1,method:'tools/call',params:{name:argv[0],arguments:args}}, {env,fetch:io.fetch ?? fetch});
    if (response.error) throw Error(response.error.message);
    (response.result.isError ? err : out)(response.result.content.map(c => c.text ?? '').join('\n'));
    return response.result.isError ? 1 : 0;
  } catch (e) { err(e.message); return 1; }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = await main(process.argv.slice(2));
}
