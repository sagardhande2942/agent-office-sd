import type { LoreNote, LoreServerMsg } from '../../shared/protocol/lore.js';
import type { FloorLore } from '../floor-actions.js';

/** The host owns disk; the office keeps a live mirror for arriving teammates. */
export class RemoteLore implements FloorLore {
  private notes: LoreNote[] = [];
  constructor(private call: (t: string, body: Record<string, unknown>) => Promise<unknown>, private supported: () => boolean) {}
  list() { return [...this.notes]; }
  reset() { this.notes = []; }
  receive(msg: LoreServerMsg) {
    if (msg.t === 'lore.all') this.notes = msg.notes;
    else if (msg.t === 'lore.saved') this.notes = [msg.note, ...this.notes.filter(note => note.id !== msg.note.id)];
    else this.notes = this.notes.filter(note => note.id !== msg.id);
  }
  private async command(t: string, body: Record<string, unknown>) {
    if (!this.supported()) throw new Error('Update the floor host to support repository memory');
    const result = await this.call(t, body);
    if (typeof result === 'string') throw new Error(result);
    return result;
  }
  async save(note: Parameters<FloorLore['save']>[0]): Promise<LoreNote> { return await this.command('lore.save', { note }) as LoreNote; }
  async delete(id: string): Promise<boolean> { return await this.command('lore.delete', { id }) === true; }
}
