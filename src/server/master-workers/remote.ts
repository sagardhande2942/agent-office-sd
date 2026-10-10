import type { TeamPreset, TeamRequest, TeamState } from '../../shared/master-workers.js';
export interface RemoteTeamSurface {
  state(): TeamState;
  presets(presets: TeamPreset[]): void;
  capacity(room: number, workers: number, paused?: string): void;
  start(request: TeamRequest, owner?: string): Promise<string | undefined>;
  control(action: 'pause' | 'resume' | 'stop', owner?: string): Promise<string | undefined>;
}
export class RemoteTeams implements RemoteTeamSurface {
  private budget: { budget: number | null; paused?: string } = { budget: 0 };
  private updating = false;
  private current: TeamState = { current: null, past: [], presets: [] };
  constructor(private call: (t: string, body: Record<string, unknown>) => Promise<unknown>, private supported: () => boolean) {}
  state() { return this.current; }
  capacity(room: number, workers: number, paused?: string) {
    this.budget = { budget: Number.isFinite(room) ? Math.max(0, Math.floor(workers + room)) : null, ...(paused ? { paused } : {}) };
    if (!this.supported() || this.updating) return;
    this.updating = true;
    void this.command('master-workers.capacity', this.budget).finally(() => { this.updating = false; });
  }
  presets(presets: TeamPreset[]) { this.current = { ...this.current, presets }; }
  receive(msg: { state: TeamState }) {
    if (!msg.state || !Array.isArray(msg.state.past)) return;
    msg.state = { ...msg.state, presets: this.current.presets };
    this.current = msg.state;
  }
  private async command(t: string, body: Record<string, unknown>) {
    if (!this.supported()) return 'Update the floor host to support Master / Workers';
    const r = await this.call(t, body); return typeof r === 'string' ? r : undefined;
  }
  start(request: TeamRequest, owner?: string) { return this.command('master-workers.start', { request, owner, ...this.budget }); }
  control(action: 'pause' | 'resume' | 'stop', owner?: string) { return this.command('master-workers.control', { action, owner, ...this.budget }); }
}
