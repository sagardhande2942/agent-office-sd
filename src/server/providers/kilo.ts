// Kilo Code: a fork of OpenCode's CLI, so a Kilo worker loads the office's OpenCode plugin from the
// workspace's own kilo.json and reports on the same /hooks/opencode bridge (hooksAs): session,
// working, tool, waiting-for-input and done statuses, usage snapshots, checkpoints and the plan
// review's tool gate all come the same way an OpenCode worker's do. Its login, providers and settings
// stay in the user's ~/.config/kilo, which the office never edits.
import { addKiloConfig, kiloArgs, removeKiloConfig } from '../kilo.js';
import { openCodeMcp } from '../office-workers.js';
import { openCodePluginSpecifier, writeOpenCodePlugin } from '../opencode.js';
import type { StatusState } from './opencode.js';
import type { ProviderAdapter } from './types.js';

interface KiloSetup {
  /** The office's plugin, as the module specifier Kilo's plugin loader takes. */
  plugin: string;
  /** The office's MCP server, when the floor has one. */
  mcp?: Record<string, unknown>;
}

export const kilo: ProviderAdapter<StatusState, KiloSetup> = {
  id: 'kilo',
  createState: () => ({}),
  prepare: ({ dataDir, mcpScript }) => ({
    plugin: openCodePluginSpecifier(writeOpenCodePlugin(dataDir)),
    ...(mcpScript ? { mcp: openCodeMcp(mcpScript) } : {}),
  }),
  launch({ h, args, prompt, resumeSessionId, cwd, setup }) {
    const { info } = h;
    if (!addKiloConfig(cwd, setup)) throw new Error(`Cannot install the office plugin in ${cwd}; check its kilo.json or kilo.jsonc`);
    h.state.error = false;
    return {
      // A resumed session carries on with the model it had, the way OpenCode's does.
      args: [...kiloArgs(args, { model: resumeSessionId ? undefined : info.model, sessionId: resumeSessionId, prompt }), ...(info.planReview?.locked ? ['--agent', 'plan'] : [])],
      rotateToken: true,
      finishEnv(env) {
        env.AGENT_OFFICE_SESSION_ID = resumeSessionId ?? '';
        // Kilo's TUI has no flag for an effort: its plugin puts the worker's first message on the
        // effort picked for it, the model's variant (see ../opencode.ts).
        env.AGENT_OFFICE_EFFORT = (!resumeSessionId && info.effort) || '';
        env.AGENT_OFFICE_MODEL = (!resumeSessionId && info.model) || '';
      },
    };
  },
  exited: (_h, cwd) => removeKiloConfig(cwd),
  titleNoise: /^kilo(code)?( cli)?$/i,
  // Kilo speaks OpenCode's plugin bridge, so its workers report where an OpenCode worker's do.
  hooksAs: 'opencode',
  screen: { blocked: text => /you need to sign in|run \/connect|kilo auth login|no api key/i.test(text) ? 'Open the terminal: run /connect in Kilo to sign in' : undefined },
  usage: { persisted: true },
};
