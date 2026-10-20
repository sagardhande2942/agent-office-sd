import type { Meeting } from '../../shared/protocol.js';
import type { PromptId, PromptVars } from '../../shared/prompts.js';
import { researchPattern } from '../../shared/research-patterns.js';
import { legacyPlan } from './legacy.js';
import { researchPlan } from './research.js';
export { researchBrief, validateResearchOutput } from './research.js';

/** Registered workflow families; the room owns generic turn scheduling and persistence. */
export function planMeeting(m: Meeting, round: number, step: number, cwd: string,
  say: (id: PromptId, vars?: PromptVars) => string) {
  return researchPattern(m.pattern) ? researchPlan(m, round, step, cwd) : legacyPlan(m, round, step, cwd, say);
}
