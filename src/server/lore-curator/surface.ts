import type { CuratorState, CuratorSettings } from '../../shared/lore-curator.js';
import type { LoreNote } from '../../shared/protocol/lore.js';
import type { Awaitable } from '../floor-actions.js';
export interface CuratorSurface {
  state(): Awaitable<CuratorState>;
  configure(settings: CuratorSettings): Awaitable<void>;
  pause(paused: boolean): Awaitable<void>;
  start(): Awaitable<void>;
  restore(id: string, revision?: number): Awaitable<void>;
  history(id: string): Awaitable<{ revision: number; note: LoreNote }[]>;
}
export class RemoteCurator implements CuratorSurface {
  constructor(private call: (t: string, body: Record<string, unknown>) => Promise<unknown>, private supported: () => boolean) {}
  private async command(t: string, body: Record<string, unknown> = {}) {
    if (!this.supported()) throw Error('Update the floor host to support automatic knowledge curation');
    const result = await this.call(t, body);
    if (typeof result === 'string') throw Error(result);
    return result;
  }
  async state() { return await this.command('curator.get') as CuratorState; }
  async configure(settings: CuratorSettings) { await this.command('curator.configure', { settings }); }
  async pause(paused: boolean) { await this.command('curator.pause', { paused }); }
  async start() { await this.command('curator.run'); }
  async restore(id: string, revision?: number) { await this.command('curator.restore', { id, revision }); }
  async history(id: string) { return await this.command('curator.history', { id }) as { revision: number; note: LoreNote }[]; }
}
