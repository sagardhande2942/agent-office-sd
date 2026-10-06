import type {Worker,WorkerHandle} from './types.js';
type Operations=Pick<WorkerHandle,'setStatus'|'emit'|'persist'|'notePrompt'|'noteTool'|'notePr'|'clearTask'|'scheduleScan'|'prompt'>;
export function workerHandle(w:Worker,operations:Operations):WorkerHandle {
    return (w.handle ??= {
      get info() {
        return w.info;
      },
      get state() {
        return w.state;
      },
      get running() {
        return !!w.pty;
      },
      get bootBlocked() {
        return !!w.bootBlocked;
      },
      set bootBlocked(v) {
        w.bootBlocked = v;
      },
      get leftNeedsInputAt() {
        return w.leftNeedsInputAt;
      },
      set leftNeedsInputAt(v) {
        w.leftNeedsInputAt = v;
      },
      get failStreak() {
        return w.failStreak;
      },
      set failStreak(v) {
        w.failStreak = v;
      },
      get tracker() {
        return w.tracker;
      },
      get pendingPrompt() {
        return w.pendingPrompt;
      },
      set pendingPrompt(v) {
        w.pendingPrompt = v;
      },
      ...operations,
    });
  }
