import type { CodingAgentsConfig, CodingAgentsState } from '../coding-agents.js';
import type { AgentProvider } from '../providers.js';

export type CodingAgentsClientMsg =
  | { t: 'codingAgents.set'; config: CodingAgentsConfig }
  | { t: 'codingAgents.reset'; provider?: AgentProvider };

export type CodingAgentsServerMsg = {
  t: 'codingAgents';
  state: CodingAgentsState;
};
