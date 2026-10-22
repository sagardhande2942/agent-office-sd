import type { Meeting } from '../../shared/protocol.js';
import type { PromptId, PromptVars } from '../../shared/prompts.js';
import { legacyPlan } from './legacy.js';
import { customPlan } from './custom.js';
export { customBrief, validateCustomOutput } from './custom.js';

/** The room owns scheduling; caller definitions own the custom stages. */
export function planMeeting(m: Meeting, round: number, step: number, cwd: string,
  say: (id: PromptId, vars?: PromptVars) => string) {
  return m.pattern === 'custom' ? customPlan(m, round, step, cwd) : legacyPlan(m, round, step, cwd, say);
}
