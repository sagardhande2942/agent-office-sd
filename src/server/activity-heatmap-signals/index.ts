import { toolAction } from '../../shared/actions.js';
import type { WorkerInfo } from '../../shared/protocol.js';
import type { WorkerFeature } from '../workers/features.js';
import type { Floor } from '../floor.js';
import { normalizeCodexHook } from '../codex.js';
import { getActivityRecorder } from '../activity-heatmap/service.js';
import { observeTeamState } from '../team-sessions.js';

type MeasuredPhase = 'checks' | 'implementation';
/** Track paired root tool boundaries, never the worker's sticky animation action. */
export class ActivityToolSignals {
  private active = new Map<string, Map<string, MeasuredPhase | null>>();
  constructor(private signal: (workerId: string, phase: MeasuredPhase | null) => void) {}
  remove(workerId: string) { this.active.delete(workerId); this.signal(workerId, null); }
  hook(worker: WorkerInfo, route: string, event: string, payload: unknown) {
    if (!['claude', 'codex'].includes(route)) return;
    const data = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
    if (data.agent_id || data.agent_type) return;
    if (route === 'codex' && !normalizeCodexHook(event, payload)) return;
    if (typeof data.session_id !== 'string' || data.session_id !== worker.sessionId) return;
    if (['SessionStart', 'UserPromptSubmit', 'Stop', 'StopFailure', 'StopCancelled', 'Interrupt'].includes(event)) return this.remove(worker.id);
    const id = typeof data.tool_use_id === 'string' && data.tool_use_id.length <= 160 ? data.tool_use_id : undefined;
    // Without a paired call id, its execution boundary cannot be attributed safely.
    if (!id) return;
    let calls = this.active.get(worker.id);
    if (!calls) this.active.set(worker.id, calls = new Map());
    if (event === 'PreToolUse') {
      if (calls.size >= 256 || calls.has(id)) return;
      const action = toolAction(data.tool_name, route === 'claude' ? data.tool_input : undefined);
      calls.set(id, action === 'test' ? 'checks' : action === 'edit' ? 'implementation' : null);
    } else if (event === 'PostToolUse' || event === 'PostToolUseFailure') calls.delete(id);
    else return;
    const phases = [...calls.values()];
    this.signal(worker.id, phases.includes('checks') ? 'checks' : phases.includes('implementation') ? 'implementation' : null);
  }
}
const disposers = new WeakMap<Floor, () => void>();
export function activitySignalFeature(floor: Floor): WorkerFeature {
  const recorder = getActivityRecorder(floor), signals = new ActivityToolSignals((id, phase) => recorder.signal(id, phase));
  disposers.set(floor, observeTeamState(floor, state => {
    for (const run of [...state.past, ...(state.current ? [state.current] : [])]) recorder.team(run);
  }));
  return { hook: (worker, route, event, payload) => signals.hook(worker, route, event, payload), remove: worker => signals.remove(worker.id), update: worker => {
    if (worker.suspended || ['done', 'exited', 'offline', 'idle'].includes(worker.status)) signals.remove(worker.id);
  } };
}
export function closeActivitySignals(floor: Floor) { disposers.get(floor)?.(); disposers.delete(floor); }
