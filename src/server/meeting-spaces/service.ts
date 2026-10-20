import { randomBytes } from 'node:crypto';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MeetingRoom, type MeetingEvents, type MeetingTrees, type MeetingWorkers } from '../meetings.js';
import type { MeetingRequest, MeetingState, WorkerInfo } from '../../shared/protocol.js';
import { DEFAULT_MEETING_SPACE, MEETING_SPACE_LIMIT, spaceName } from '../../shared/meeting-spaces.js';
import { meetingMemoryContext, meetingMemoryGate } from '../knowledge/meetings.js';

interface Space { id: string; name: string; createdAt: number; room: MeetingRoom }
/** Each space runs the existing meeting workflow independently; selecting one is a browser concern. */
export class MeetingSpaces {
  private spaces = new Map<string, Space>();
  private file: string;
  constructor(private dir: string, private dataDir: string, private workers: MeetingWorkers, private trees: MeetingTrees | undefined, private events: MeetingEvents) {
    this.file = path.join(dataDir, 'meeting-spaces.json');
    this.add(DEFAULT_MEETING_SPACE, 'Main meeting', Date.now());
    try {
      const saved = JSON.parse(readFileSync(this.file, 'utf8'));
      if (Array.isArray(saved)) for (const item of saved.slice(0, MEETING_SPACE_LIMIT)) {
        const name = spaceName(item?.name);
        if (!name || typeof item.id !== 'string' || !/^(main|[a-f0-9]{16})$/.test(item.id)) continue;
        if (item.id === DEFAULT_MEETING_SPACE) { const main = this.spaces.get(item.id)!; main.name = name; main.createdAt = Number(item.createdAt) || main.createdAt; }
        else if (!this.spaces.has(item.id)) this.add(item.id, name, Number(item.createdAt) || Date.now());
      }
    } catch { /* Legacy floors retain their original meeting without a catalogue. */ }
  }
  private add(id: string, name: string, createdAt: number) {
    const data = id === DEFAULT_MEETING_SPACE ? this.dataDir : path.join(this.dataDir, 'meeting-spaces', id);
    mkdirSync(data, { recursive: true });
    const owned = new Set<string>();
    let room: MeetingRoom;
    const workers: MeetingWorkers = {
      defaultProvider: this.workers.defaultProvider,
      get officeDefault() { return source.officeDefault; },
      list: () => { const current = room?.state().current?.id; return this.workers.list().filter(w => !w.meeting || w.meeting === current || owned.has(w.id)); },
      activeSince: (wid, at) => this.workers.activeSince?.(wid, at) ?? false,
      seat: (...args) => { const w = this.workers.seat(...args); if (typeof w !== 'string') owned.add(w.id); return w; },
      prompt: (...args) => this.workers.prompt(...args),
      write: (...args) => this.workers.write(...args),
      kill: wid => this.workers.kill(wid),
    };
    const source = this.workers;
    room = new MeetingRoom(this.dir, data, workers, this.trees, { memoryContext: m => meetingMemoryContext(this.dir, m), memoryGate: m => meetingMemoryGate(this.dir, m), ...this.events, update: () => this.events.update(this.state()) });
    this.spaces.set(id, { id, name, createdAt, room });
  }
  state(): MeetingState {
    const main = this.spaces.get(DEFAULT_MEETING_SPACE)!.room.state();
    return { ...main, spaces: [...this.spaces.values()].map(({ id, name, createdAt, room }) => ({ id, name, createdAt, ...room.state() })) };
  }
  create(name: unknown): string | undefined {
    const clean = spaceName(name);
    if (!clean) return 'Give the space a name of 1–60 characters';
    if (this.spaces.size >= MEETING_SPACE_LIMIT) return `A floor supports up to ${MEETING_SPACE_LIMIT} meeting spaces`;
    if ([...this.spaces.values()].some(s => s.name.toLowerCase() === clean.toLowerCase())) return 'A meeting space already has that name';
    const id = randomBytes(8).toString('hex');
    this.add(id, clean, Date.now());
    const error = this.save();
    if (error) { this.spaces.get(id)!.room.shutdown(); this.spaces.delete(id); return error; }
    this.events.update(this.state());
  }
  rename(id: string, name: unknown): string | undefined {
    const space = this.spaces.get(id), clean = spaceName(name);
    if (!space) return 'No such meeting space';
    if (!clean) return 'Give the space a name of 1–60 characters';
    if ([...this.spaces.values()].some(s => s.id !== id && s.name.toLowerCase() === clean.toLowerCase())) return 'A meeting space already has that name';
    const before = space.name; space.name = clean;
    const error = this.save(); if (error) { space.name = before; return error; }
    this.events.update(this.state());
  }
  private save(): string | undefined {
    try {
      writeFileSync(this.file + '.tmp', JSON.stringify([...this.spaces.values()].map(({ id, name, createdAt }) => ({ id, name, createdAt }))), { mode: 0o600 });
      renameSync(this.file + '.tmp', this.file);
    } catch { return 'Could not save the meeting space; check the floor storage'; }
  }
  start(req: MeetingRequest, by: string, owner?: string, execution?: { key: string; id: string }): string | undefined {
    const space = this.spaces.get(req.spaceId ?? DEFAULT_MEETING_SPACE);
    if (!space) return 'No such meeting space';
    if (!this.trees && [...this.spaces.values()].some(s => s.id !== space.id && s.room.state().current?.status === 'running')) return 'Parallel meetings need a Git project so each meeting has its own worktree';
    return space.room.start(req, by, owner, execution);
  }
  stop(by: string, spaceId = DEFAULT_MEETING_SPACE) { return this.spaces.get(spaceId)?.room.stop(by) ?? (this.spaces.has(spaceId) ? undefined : 'No such meeting space'); }
  clear(by: string, spaceId = DEFAULT_MEETING_SPACE) { return this.spaces.get(spaceId)?.room.clear(by) ?? (this.spaces.has(spaceId) ? undefined : 'No such meeting space'); }
  finishAnyway(id: string, by: string) {
    const space = [...this.spaces.values()].find(s => s.room.state().current?.id === id);
    return space ? space.room.finishAnyway(id, by) : 'No such meeting';
  }
  onWorker(info: WorkerInfo) { for (const s of this.spaces.values()) s.room.onWorker(info); }
  onWorkerGone(id: string) { for (const s of this.spaces.values()) s.room.onWorkerGone(id); }
  pump() { for (const s of this.spaces.values()) s.room.pump(); }
  shutdown() { for (const s of this.spaces.values()) s.room.shutdown(); }
}
