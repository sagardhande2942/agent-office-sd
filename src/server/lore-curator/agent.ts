import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import type { CuratorProvider, CuratorSettings } from '../../shared/lore-curator.js';
import { CURATOR_PROVIDERS } from '../../shared/lore-curator.js';
import { providerCommand } from '../agents.js';
import { resolveCommand } from '../workers/process.js';
export type CuratorAgent = (settings: CuratorSettings, prompt: string, signal: AbortSignal) => Promise<unknown>;
export const CURATOR_SCHEMA = { type: 'object', additionalProperties: false, required: ['summary', 'actions'], properties: {
  summary: { type: 'string' }, actions: { type: 'array', items: { type: 'object', additionalProperties: false,
    required: ['action', 'id', 'target', 'reason', 'evidence'], properties: { action: { type: 'string', enum: ['merge', 'archive', 'verify', 'flag'] },
      id: { type: 'string' }, target: { type: 'string' }, reason: { type: 'string' }, evidence: { type: 'array', items: { type: 'string' } } } } } } };
export function curatorCommands(agentCmd: string): Partial<Record<CuratorProvider, string>> {
  return Object.fromEntries(CURATOR_PROVIDERS.map(p => [p, resolveCommand(providerCommand(p, agentCmd))]).filter(([, cmd]) => !!cmd));
}
/** Noninteractive adapters are deliberately isolated from office management tools and hooks. */
export function createCuratorAgent(commands: Partial<Record<CuratorProvider, string>>): CuratorAgent {
  return async (settings, prompt, signal) => {
    const command = commands[settings.provider];
    if (!command) throw Error(`${settings.provider} is not installed on this floor's machine`);
    const temp = mkdtempSync(path.join(os.tmpdir(), 'office-curator-'));
    try {
      const result = path.join(temp, 'result.json'), schema = path.join(temp, 'schema.json');
      writeFileSync(schema, JSON.stringify(CURATOR_SCHEMA), { mode: 0o600 });
      const args = settings.provider === 'claude'
        ? ['--print', '--output-format', 'json', '--json-schema', JSON.stringify(CURATOR_SCHEMA), '--tools', '', '--strict-mcp-config', '--mcp-config', '{"mcpServers":{}}', '--setting-sources', '', '--settings', '{"disableAllHooks":true}', '--disable-slash-commands', '--no-session-persistence', '--max-turns', '2']
        : ['exec', '--ignore-user-config', '--ignore-rules', '--ephemeral', '--skip-git-repo-check', '--sandbox', 'read-only', '-c', 'approval_policy="never"', '-c', 'web_search="disabled"', ...['shell_tool', 'unified_exec', 'apps', 'plugins', 'hooks'].flatMap(f => ['--disable', f]), '--output-schema', schema, '--output-last-message', result];
      if (settings.model) args.push('--model', settings.model);
      if (settings.provider === 'codex') args.push('-');
      const env = { ...process.env };
      for (const key of Object.keys(env)) if (/^(AGENT_OFFICE_|CLAUDECODE$|CLAUDE_CODE_|CODEX_THREAD_ID$|CODEX_INTERNAL_ORIGINATOR_OVERRIDE$)/.test(key)) delete env[key];
      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(command, args, { cwd: temp, env, stdio: ['pipe', 'pipe', 'pipe'], signal, killSignal: 'SIGKILL', timeout: 5 * 60000 });
        let out = '', bytes = 0, capped = false;
        const receive = (chunk: Buffer, stdout: boolean) => {
          bytes += chunk.length; if (bytes > 1024 * 1024) { capped = true; child.kill('SIGKILL'); }
          else if (stdout) out += chunk.toString();
        };
        child.stdout.on('data', c => receive(c, true)); child.stderr.on('data', c => receive(c, false));
        child.stdin.on('error', () => {}); child.stdin.end(prompt);
        child.on('error', reject);
        child.on('close', (code, sig) => code === 0 && !capped ? resolve(out) : reject(Error(capped ? 'Curator output exceeded its limit' : `Curator agent ended (${sig ?? code}); check its installation, login and chosen model`)));
      });
      if (settings.provider === 'codex') return JSON.parse(readFileSync(result, 'utf8'));
      const envelope = JSON.parse(output);
      if (envelope.is_error) throw Error('Curator agent returned an error; check login and model');
      return envelope.structured_output ?? JSON.parse(envelope.result ?? output);
    } finally { rmSync(temp, { recursive: true, force: true }); }
  };
}
