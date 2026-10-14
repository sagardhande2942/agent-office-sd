// Kilo Code's CLI: its command line, and the one config entry the office adds to the workspace it
// runs in. Kilo's CLI is a fork of OpenCode's and loads the same plugin modules, so a Kilo worker
// gets the plugin the office gives an OpenCode worker (see ./opencode.ts) and reports on the same
// /hooks/opencode bridge. The person's own login, providers, agents and settings stay where the CLI
// already keeps them, in ~/.config/kilo and ~/.local/share/kilo: nothing global is edited.
import { existsSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { excludeFromGit } from './config.js';

/** Kilo reads kilo.jsonc before kilo.json in a project, so an existing .jsonc is the one to merge into. */
const CONFIG_JSONC = 'kilo.jsonc';
const CONFIG_JSON = 'kilo.json';
/** What marks the office's own plugin entry, so a project that lists it itself is never rewritten. */
const PLUGIN_MARK = 'agent-office-opencode';
/** The office's MCP server, under this name in a config file (see office-workers.ts). */
const MCP_NAME = 'agent-office';

/** The config file the office merges into: the project's own .jsonc when it has one, else .json. */
function configFile(cwd: string): string {
  const jsonc = path.join(cwd, CONFIG_JSONC);
  return existsSync(jsonc) ? jsonc : path.join(cwd, CONFIG_JSON);
}

/** How many of the floor's Kilo workers hold an entry in each config file, so the last one out takes it away. */
const holders = new Map<string, number>();
/** What a config file held before the office first added its entry to it. */
const originals = new Map<string, string>();
/** The config files the office made, which go with its entry unless Kilo has since written something of its own. */
const made = new Set<string>();
/** The one key Kilo writes into a config file of its own accord (its schema URL), which is not content. */
const KILO_OWN_KEY = '$schema';

const record = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);

/** A config file as JSON, or undefined when Kilo would read it and this office cannot (comments, trailing commas). */
function parseConfig(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(text);
    return record(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

/** Two configs that say the same thing, whatever order and spacing they were written in. */
function sameConfig(a: Record<string, unknown> | undefined, b: Record<string, unknown>): boolean {
  return !!a && JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Add the office's plugin, and the office's MCP server where there is one, to the workspace's Kilo
 * config, so a worker launched there reports statuses, usage and checkpoints. Says whether it went
 * in: a config Kilo reads and the office cannot parse is left exactly as it is, so the launch fails
 * naming the file rather than a worker starting with no bridge and no plan-review tool gate.
 */
export function addKiloConfig(cwd: string, options: { plugin: string; mcp?: Record<string, unknown> }): boolean {
  const file = configFile(cwd);
  const existed = existsSync(file);
  let config: Record<string, unknown> = {};
  if (existed) {
    const text = readFileSync(file, 'utf8');
    const parsed = parseConfig(text);
    if (!parsed || (parsed.plugin !== undefined && !Array.isArray(parsed.plugin))) return false;
    config = parsed;
    originals.set(file, text);
  }
  const plugins = Array.isArray(config.plugin) ? config.plugin.filter((entry) => typeof entry === 'string') : [];
  if (!plugins.includes(options.plugin)) plugins.push(options.plugin);
  config.plugin = plugins;
  if (options.mcp) config.mcp = { ...(record(config.mcp) ? config.mcp : {}), ...options.mcp };
  writeFileSync(file, JSON.stringify(config, null, 2) + '\n');
  holders.set(file, (holders.get(file) ?? 0) + 1);
  // A file the office made is listed in .git/info/exclude, so it never counts as a change of the worker's.
  if (!existed) {
    made.add(file);
    excludeFromGit(cwd, path.basename(file));
  }
  return true;
}

/**
 * Take the office's entry out again, once no Kilo worker on this floor is using it. A config that
 * held something else is put back as it was when nothing else in it changed; a file the office made
 * goes with its entry.
 */
export function removeKiloConfig(cwd: string): void {
  for (const name of [CONFIG_JSONC, CONFIG_JSON]) {
    const file = path.join(cwd, name);
    const held = holders.get(file);
    if (!held) continue;
    if (held > 1) {
      holders.set(file, held - 1);
      continue;
    }
    holders.delete(file);
    if (!existsSync(file)) continue;
    const config = parseConfig(readFileSync(file, 'utf8'));
    if (!config) continue;
    const plugins = Array.isArray(config.plugin) ? config.plugin.filter((entry) => typeof entry === 'string' && !entry.includes(PLUGIN_MARK)) : [];
    if (plugins.length) config.plugin = plugins;
    else delete config.plugin;
    const mcp = record(config.mcp) ? Object.fromEntries(Object.entries(config.mcp).filter(([server]) => server !== MCP_NAME)) : {};
    if (Object.keys(mcp).length) config.mcp = mcp;
    else delete config.mcp;
    const original = originals.get(file);
    // Kilo writes its schema URL into a config file it reads, which is no reason to leave one behind.
    const left = Object.keys(config).filter((key) => key !== KILO_OWN_KEY || !made.has(file));
    if (!left.length) {
      originals.delete(file);
      made.delete(file);
      unlinkSync(file);
    } else if (original !== undefined && sameConfig(parseConfig(original), config)) {
      // Nothing of the project's is left but the office's entry: its own text goes back, comments and all.
      originals.delete(file);
      writeFileSync(file, original);
    } else writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`);
  }
}

/**
 * Kilo argv: the office's own `--agent-args` first, so a Kilo worker respects them, then the
 * conversation to resume, the model and the first prompt. A flag that would hand the run to another
 * conversation, approve its permissions for it or switch the office's own plugin off is dropped: the
 * office sets those per worker instead.
 */
export function kiloArgs(extra: string[], options: { model?: string; prompt?: string; sessionId?: string }): string[] {
  const valued = ['--model', '-m', '--prompt', '--session', '-s', '--agent', '--worktree'];
  const flags = ['--continue', '-c', '--fork', '--cloud-fork', '--auto', '--pure', '--share'];
  const clean: string[] = [];
  for (let i = 0; i < extra.length; i++) {
    const arg = extra[i];
    if (arg === '--') break;
    if (flags.includes(arg)) continue;
    if (valued.includes(arg)) {
      if (extra[i + 1] !== undefined && !extra[i + 1].startsWith('-')) i++;
      continue;
    }
    if (valued.some((name) => arg.startsWith(`${name}=`)) || (arg.startsWith('-m') && arg.length > 2)) continue;
    clean.push(arg);
  }
  if (options.sessionId) clean.push('--session', options.sessionId);
  if (options.model) clean.push('--model', options.model);
  if (options.prompt) clean.push('--prompt', options.prompt);
  return clean;
}
