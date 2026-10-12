import fs from 'node:fs';
import path from 'node:path';
import { KNOWLEDGE_DEFAULTS, type KnowledgeConfig } from './store.js';
/** Project-local configuration is committed separately from private usage/review state. */
export function loadKnowledgeConfig(checkout: string): KnowledgeConfig {
  const file = path.join(checkout, '.agent-office/knowledge.json');
  if (!fs.existsSync(file)) return { ...KNOWLEDGE_DEFAULTS };
  const input = JSON.parse(fs.readFileSync(file, 'utf8')) as Partial<KnowledgeConfig>;
  for (const key of Object.keys(input)) if (!Object.hasOwn(KNOWLEDGE_DEFAULTS, key)) throw Error(`Unknown knowledge setting: ${key}`);
  for (const key of ['bootstrapBudgetChars', 'hintCount', 'maxNoteBytes', 'searchMaxHits'] as const) if (input[key] !== undefined && (!Number.isInteger(input[key]) || input[key]! < (key === 'bootstrapBudgetChars' ? 1000 : 1))) throw Error(`Invalid knowledge.${key}`);
  if (input.reviewPolicy && !['required', 'prompt', 'off'].includes(input.reviewPolicy)) throw Error('Invalid reviewPolicy');
  if (input.commitMode && !['worker', 'office', 'none'].includes(input.commitMode)) throw Error('Invalid commitMode');
  for (const key of ['dir', 'handoversDir'] as const) if (input[key] !== undefined && (typeof input[key] !== 'string' || !input[key] || path.isAbsolute(input[key]!) || input[key]!.split(/[\\/]/).includes('..'))) throw Error(`Invalid knowledge.${key}`);
  for (const key of ['mrSection', 'legacyLore'] as const) if (input[key] !== undefined && typeof input[key] !== 'boolean') throw Error(`Invalid knowledge.${key}`);
  return { ...KNOWLEDGE_DEFAULTS, ...input };
}
