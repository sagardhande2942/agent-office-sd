import { defaultCodingAgentsState, type CodingAgentsState } from '../../../shared/coding-agents';
import type { Slice } from '../store';

declare module '../store' {
  interface Store { codingAgents: CodingAgentsState }
  interface Topics { codingAgents: true }
}

export const codingAgents: Slice = {
  init(s) { s.codingAgents = defaultCodingAgentsState(); },
  enter(s, m) { s.codingAgents = m.codingAgents ?? defaultCodingAgentsState(); return ['codingAgents']; },
  on: { codingAgents(s, m) { s.codingAgents = m.state; return ['codingAgents']; } },
};
