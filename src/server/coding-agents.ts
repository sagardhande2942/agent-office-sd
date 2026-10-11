import fs from 'node:fs';
import path from 'node:path';
import {
  defaultCodingAgentsState,
  validCodingAgentsConfig,
  type CodingAgentsConfig,
  type CodingAgentsState,
  type ProviderConfig,
} from '../shared/coding-agents.js';
import type { AgentEffort, AgentProvider, WorkerInfo } from '../shared/protocol.js';
import type { LaunchPlan } from './providers/types.js';

export class CodingAgents {
  private current: CodingAgentsState = defaultCodingAgentsState();
  private file: string;

  constructor(
    dataDir: string,
    private publish: (state: CodingAgentsState) => void = () => {},
  ) {
    this.file = path.join(dataDir, 'coding-agents.json');
    this.load();
  }

  private load() {
    try {
      if (fs.existsSync(this.file)) {
        const raw = fs.readFileSync(this.file, 'utf8');
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === 'object') {
          if (validCodingAgentsConfig(parsed.config)) {
            this.current.config = { ...this.current.config, ...parsed.config };
          }
          if (typeof parsed.by === 'string') this.current.by = parsed.by;
          if (typeof parsed.at === 'number') this.current.at = parsed.at;
        }
      }
    } catch {
      // Keep default state on parse error
    }
  }

  private save(): boolean {
    try {
      fs.mkdirSync(path.dirname(this.file), { recursive: true });
      const tmp = `${this.file}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.current, null, 2), { mode: 0o600 });
      fs.renameSync(tmp, this.file);
      return true;
    } catch {
      return false;
    }
  }

  state(): CodingAgentsState {
    return structuredClone(this.current);
  }

  set(config: unknown, by?: string): string | undefined {
    if (!validCodingAgentsConfig(config)) {
      return 'Invalid coding agent configuration';
    }
    const previous = structuredClone(this.current);
    this.current = {
      config: structuredClone(config),
      by,
      at: Date.now(),
    };
    if (!this.save()) {
      this.current = previous;
      return 'Failed to save coding agent configuration to disk';
    }
    this.publish(this.state());
    return undefined;
  }

  reset(by?: string) {
    this.current = defaultCodingAgentsState();
    this.current.by = by;
    this.current.at = Date.now();
    this.save();
    this.publish(this.state());
  }

  isProviderEnabled(provider?: AgentProvider): boolean {
    if (!provider) return true;
    const cfg = this.current.config[provider];
    return cfg ? cfg.enabled : true;
  }

  defaultModel(provider?: AgentProvider): string | undefined {
    if (!provider) return undefined;
    const cfg = this.current.config[provider];
    return cfg?.model && cfg.model.trim() ? cfg.model.trim() : undefined;
  }

  defaultEffort(provider?: AgentProvider): AgentEffort | undefined {
    if (!provider) return undefined;
    const cfg = this.current.config[provider];
    return cfg?.effort;
  }

  applyLaunch(provider: AgentProvider | undefined, plan: LaunchPlan, _info: WorkerInfo): void {
    if (!provider) return;
    const cfg: ProviderConfig | undefined = this.current.config[provider];
    if (!cfg) return;

    if (cfg.extraArgs && cfg.extraArgs.length > 0) {
      plan.args.push(...cfg.extraArgs);
    }

    if (cfg.env && Object.keys(cfg.env).length > 0) {
      plan.env = { ...plan.env, ...cfg.env };
    }

    switch (provider) {
      case 'claude': {
        if (cfg.permissionMode === 'auto-approve') {
          if (!plan.args.includes('--dangerously-skip-permissions')) {
            plan.args.push('--dangerously-skip-permissions');
          }
        } else if (cfg.permissionMode === 'restricted') {
          if (!plan.args.includes('--tools')) {
            plan.args.push('--tools', 'Read,Glob,Grep');
          }
        }

        const disallowed: string[] = [];
        if (cfg.tools?.bash === 'deny') disallowed.push('Bash');
        if (cfg.tools?.edit === 'deny') disallowed.push('Edit', 'Write');
        if (disallowed.length > 0) {
          plan.args.push('--disallowedTools', ...disallowed);
        }
        break;
      }

      case 'opencode': {
        const origFinish = plan.finishEnv;
        plan.finishEnv = (env) => {
          origFinish?.(env);
          if (env.OPENCODE_CONFIG_CONTENT) {
            try {
              const parsed = JSON.parse(env.OPENCODE_CONFIG_CONTENT);
              if (cfg.permissionMode === 'auto-approve') {
                parsed.permission = { '*': 'allow' };
              } else if (cfg.permissionMode === 'restricted') {
                parsed.permission = { '*': 'deny', read: 'allow', glob: 'allow', grep: 'allow', list: 'allow' };
              } else if (cfg.tools) {
                const perm: Record<string, string> = typeof parsed.permission === 'object' && parsed.permission ? { ...parsed.permission } : {};
                if (cfg.tools.bash) perm.bash = cfg.tools.bash;
                if (cfg.tools.edit) {
                  perm.edit = cfg.tools.edit;
                  perm.write = cfg.tools.edit;
                }
                parsed.permission = perm;
              }
              env.OPENCODE_CONFIG_CONTENT = JSON.stringify(parsed);
            } catch {
              // Ignore JSON parse errors in finishEnv
            }
          }
        };
        break;
      }

      case 'codex': {
        if (cfg.permissionMode === 'auto-approve') {
          plan.args.push('--ask-for-approval', 'never');
        } else if (cfg.permissionMode === 'restricted') {
          plan.args.push('--sandbox', 'read-only', '--ask-for-approval', 'never');
        }
        break;
      }

      case 'antigravity': {
        if (cfg.permissionMode === 'restricted') {
          plan.args.push('--mode', 'plan');
        }
        break;
      }

      case 'cursor': {
        if (cfg.permissionMode === 'restricted') {
          plan.args.push('--mode=plan');
        } else if (cfg.permissionMode === 'auto-approve') {
          if (!plan.args.includes('--trust')) plan.args.push('--trust');
        }
        break;
      }

      case 'muse': {
        if (cfg.permissionMode === 'auto-approve') {
          plan.args.push('--approval-mode', 'never');
        }
        break;
      }
    }
  }
}
