import { addAntigravityHooks, antigravityArgs, normalizeAntigravityHook, removeAntigravityHooks, writeAntigravityHook } from '../antigravity.js';
import { reduceLifecycle } from '../workers/lifecycle.js';
import type { ProviderAdapter } from './types.js';

export const antigravity: ProviderAdapter<undefined, { helper: string }> = {
  id: 'antigravity',
  prepare: ({ dataDir }) => ({ helper: writeAntigravityHook(dataDir) }),
  launch({ h, args, prompt, resumeSessionId, cwd, setup }) {
    if (!addAntigravityHooks(cwd, setup.helper, h.info.id)) throw new Error('Cannot install Antigravity workspace hooks; check .agents/hooks.json');
    args = antigravityArgs(args, h.info.model, h.info.effort, resumeSessionId);
    if (h.info.planReview?.locked) args.push('--mode', 'plan');
    if (prompt) args.push('--prompt-interactive', prompt);
    return { args, rotateToken: true };
  },
  exited: ({ info }, cwd) => removeAntigravityHooks(cwd, info.id),
  titleNoise: /^(antigravity|agy)( cli)?$/i,
  hook: {
    strictJson: true,
    handle(h, event, payload) {
      const report = normalizeAntigravityHook(event, payload);
      if (!report) return false;
      // Only the root conversation selected at launch may change this desk's status.
      return reduceLifecycle(h, report);
    },
  },
  screen: { blocked: text => /sign in with google|open.*browser.*sign.?in|workspace trust/i.test(text) ? 'Open the terminal: complete Antigravity login or workspace trust' : undefined },
};
