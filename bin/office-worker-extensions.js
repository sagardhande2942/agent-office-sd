import { KNOWLEDGE_TOOL_EXTENSION } from './office-knowledge-tools.js';
import { BOSS_TOOL_EXTENSION } from './office-boss-tools.js';
import { LORE_TOOL_EXTENSION } from './office-lore-tools.js';

/** CLI and MCP extensions register their own commands, HTTP paths and tools. */
export const WORKER_TOOL_EXTENSIONS = [KNOWLEDGE_TOOL_EXTENSION, LORE_TOOL_EXTENSION, BOSS_TOOL_EXTENSION];
export const WORKER_EXTENSION_ACTIONS = Object.assign({}, ...WORKER_TOOL_EXTENSIONS.map(e => e.actions));
export const WORKER_EXTENSION_READS = new Set(WORKER_TOOL_EXTENSIONS.flatMap(e => e.reads));
export const WORKER_EXTENSION_TOOLS = WORKER_TOOL_EXTENSIONS.flatMap(e => e.tools);
