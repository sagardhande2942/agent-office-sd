import { AGENT_PROVIDERS, takesModel, type AgentProvider } from './providers.js';

/** Planning uses the same provider registry as hiring, for all providers with selectable models. */
export function planProviders(available: readonly AgentProvider[] = AGENT_PROVIDERS): AgentProvider[] {
  return AGENT_PROVIDERS.filter(p => available.includes(p) && takesModel(p));
}

/** Only Claude/OpenCode aliases are canonicalized across CLIs; other model IDs are provider-local. */
export function planModelIdentity(provider: AgentProvider, model?: string): string {
  const id = model?.toLowerCase() ?? 'default';
  if (provider === 'claude') return `anthropic/${id}`;
  if (provider === 'opencode' && /^anthropic\/(sonnet|haiku|opus|fable)$/.test(id)) return id;
  return `${provider}:${id}`;
}
