import { AGENT_PROVIDERS, isAgentEffort, isAgentProvider, providerMeta, type AgentEffort, type AgentProvider } from './providers.js';

export type PermissionMode = 'default' | 'auto-approve' | 'restricted';
export const PERMISSION_MODES: readonly PermissionMode[] = ['default', 'auto-approve', 'restricted'];

export function isPermissionMode(value: unknown): value is PermissionMode {
  return typeof value === 'string' && (PERMISSION_MODES as readonly string[]).includes(value);
}

export type ToolPermission = 'allow' | 'ask' | 'deny';
export const TOOL_PERMISSIONS: readonly ToolPermission[] = ['allow', 'ask', 'deny'];

export function isToolPermission(value: unknown): value is ToolPermission {
  return typeof value === 'string' && (TOOL_PERMISSIONS as readonly string[]).includes(value);
}

export interface ProviderToolPermissions {
  edit?: ToolPermission;
  bash?: ToolPermission;
  web?: ToolPermission;
}

export interface ProviderConfig {
  enabled: boolean;
  permissionMode: PermissionMode;
  tools?: ProviderToolPermissions;
  model?: string;
  effort?: AgentEffort;
  extraArgs?: string[];
  env?: Record<string, string>;
}

export type CodingAgentsConfig = Partial<Record<AgentProvider, ProviderConfig>>;

export interface CodingAgentsState {
  config: CodingAgentsConfig;
  by?: string;
  at?: number;
}

export function defaultProviderConfig(_provider: AgentProvider): ProviderConfig {
  return {
    enabled: true,
    permissionMode: 'default',
    tools: {
      edit: 'ask',
      bash: 'ask',
      web: 'ask',
    },
  };
}

export function defaultCodingAgentsConfig(): CodingAgentsConfig {
  const config: CodingAgentsConfig = {};
  for (const p of AGENT_PROVIDERS) {
    config[p] = defaultProviderConfig(p);
  }
  return config;
}

export function defaultCodingAgentsState(): CodingAgentsState {
  return {
    config: defaultCodingAgentsConfig(),
  };
}

export function validProviderConfig(provider: AgentProvider, value: unknown): value is ProviderConfig {
  if (!value || typeof value !== 'object') return false;
  const p = value as Record<string, unknown>;
  if (typeof p.enabled !== 'boolean') return false;
  if (!isPermissionMode(p.permissionMode)) return false;

  if (p.tools !== undefined) {
    if (!p.tools || typeof p.tools !== 'object') return false;
    const tools = p.tools as Record<string, unknown>;
    if (tools.edit !== undefined && !isToolPermission(tools.edit)) return false;
    if (tools.bash !== undefined && !isToolPermission(tools.bash)) return false;
    if (tools.web !== undefined && !isToolPermission(tools.web)) return false;
  }

  if (p.model !== undefined && p.model !== '') {
    const meta = providerMeta(provider);
    if (!meta?.validModel || !meta.validModel(p.model)) return false;
  }

  if (p.effort !== undefined && !isAgentEffort(p.effort)) return false;

  if (p.extraArgs !== undefined) {
    if (!Array.isArray(p.extraArgs) || !p.extraArgs.every((a) => typeof a === 'string')) return false;
  }

  if (p.env !== undefined) {
    if (!p.env || typeof p.env !== 'object') return false;
    for (const [k, v] of Object.entries(p.env)) {
      if (typeof k !== 'string' || typeof v !== 'string') return false;
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(k)) return false;
    }
  }

  return true;
}

export function validCodingAgentsConfig(value: unknown): value is CodingAgentsConfig {
  if (!value || typeof value !== 'object') return false;
  for (const [provider, cfg] of Object.entries(value)) {
    if (!isAgentProvider(provider)) return false;
    if (!validProviderConfig(provider, cfg)) return false;
  }
  return true;
}
