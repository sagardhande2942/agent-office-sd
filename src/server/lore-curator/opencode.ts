import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
/** Read JSONC without evaluating configuration or loading its plugins. */
function jsonc(text: string): Record<string, unknown> {
  let clean = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) { clean += c; if (c === '\\') clean += text[++i]; else if (c === '"') quoted = false; continue; }
    if (c === '"') { quoted = true; clean += c; }
    else if (c === '/' && text[i + 1] === '/') { while (i < text.length && text[i] !== '\n') i++; clean += '\n'; }
    else if (c === '/' && text[i + 1] === '*') { i += 2; while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) i++; i++; clean += ' '; }
    else clean += c;
  }
  // Remove trailing commas only outside strings.
  quoted = false; let result = '';
  for (let i = 0; i < clean.length; i++) {
    const c = clean[i];
    if (quoted) { result += c; if (c === '\\') result += clean[++i]; else if (c === '"') quoted = false; }
    else if (c === '"') { quoted = true; result += c; }
    else if (c !== ',' || !/^\s*[}\]]/.test(clean.slice(i + 1))) result += c;
  }
  return JSON.parse(result);
}
export function isolateOpenCode(env: NodeJS.ProcessEnv, temp: string) {
  const home = env.HOME || env.USERPROFILE || os.homedir();
  const configHome = env.XDG_CONFIG_HOME || path.join(home, '.config');
  const config: Record<string, unknown> = {};
  const files = ['config.json', 'opencode.json', 'opencode.jsonc'].map(n => path.join(configHome, 'opencode', n));
  if (env.OPENCODE_CONFIG) files.push(env.OPENCODE_CONFIG);
  for (const file of files) if (fs.existsSync(file)) Object.assign(config, jsonc(fs.readFileSync(file, 'utf8')));
  if (env.OPENCODE_CONFIG_CONTENT) Object.assign(config, jsonc(env.OPENCODE_CONFIG_CONTENT));
  // Keep authentication/provider routing. Never import agents, tools, hooks or MCP.
  const isolated = { provider: config.provider, model: config.model, small_model: config.small_model,
    permission: { '*': 'deny' }, plugin: [], mcp: {}, instructions: [], lsp: false, formatter: false };
  env.XDG_DATA_HOME ||= path.join(home, '.local', 'share');
  env.HOME = temp; env.USERPROFILE = temp;
  env.XDG_CONFIG_HOME = path.join(temp, 'config'); env.XDG_STATE_HOME = path.join(temp, 'state');
  env.OPENCODE_CONFIG_DIR = path.join(temp, 'config', 'opencode');
  delete env.OPENCODE_CONFIG;
  env.OPENCODE_CONFIG_CONTENT = JSON.stringify(isolated);
  env.OPENCODE_DISABLE_PROJECT_CONFIG = 'true'; env.OPENCODE_DISABLE_DEFAULT_PLUGINS = 'true';
}
export function parseOpenCodeOutput(output: string): unknown {
  let text = '';
  for (const line of output.split(/\r?\n/).filter(l => l.trim())) {
    const event = JSON.parse(line);
    if (event.type === 'error') throw Error(`OpenCode curator error: ${event.error?.data?.message ?? event.error?.message ?? 'request failed'}`);
    if (event.type === 'tool_use' || event.part?.type === 'tool') throw Error('OpenCode curator attempted a forbidden tool');
    if (event.type === 'text') text += event.part?.text ?? '';
  }
  // Accept one JSON object, optionally fenced, never recover arbitrary prose.
  return JSON.parse(text.trim().replace(/^```(?:json)?\s*\n([\s\S]*)\n```$/, '$1'));
}
