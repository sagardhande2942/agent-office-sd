import fs from 'node:fs';
import path from 'node:path';
import { defaultAppearanceState, validAppearanceConfig, isFictionalCharacter, type AppearanceState } from '../shared/appearances.js';
export interface AppearanceWorker { id: string; createdAt: number; floor?: string }
/** One allocator for the building, including helpers, shells and remote floors. */
export class Appearances {
  private current = defaultAppearanceState();
  private slots: Record<string, boolean> = {};
  private known: Record<string, AppearanceWorker> = {};
  private nextFictional = false;
  private active = false;
  private file: string;
  constructor(dataDir: string, private workers: () => AppearanceWorker[], private publish: (state: AppearanceState) => void, private reserved: (worker: AppearanceWorker) => boolean = () => false) {
    this.file = path.join(dataDir, 'worker-appearances.json');
    try {
      const saved = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      if (validAppearanceConfig(saved.config)) this.current.config = saved.config;
      if (saved.assignments && typeof saved.assignments === 'object') for (const [id, look] of Object.entries(saved.assignments)) {
        if (look === 'original' || isFictionalCharacter(look)) this.current.assignments[id] = look;
      }
      if (saved.slots && typeof saved.slots === 'object') for (const [id, slot] of Object.entries(saved.slots)) this.slots[id] = slot === true;
      if (saved.known && typeof saved.known === 'object') for (const [id, w] of Object.entries(saved.known)) {
        const worker = w as AppearanceWorker;
        if (worker?.id === id && Number.isFinite(worker.createdAt)) this.known[id] = worker;
      }
      this.nextFictional = saved.nextFictional === true;
    } catch { /* New offices start with Original. */ }
  }
  state(): AppearanceState { return structuredClone(this.current); }
  activate() { this.active = true; this.reconcile(); }
  private save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const temp = this.file + '.tmp';
    fs.writeFileSync(temp, JSON.stringify({ ...this.current, slots: this.slots, known: this.known, nextFictional: this.nextFictional }), { mode: 0o600 });
    fs.renameSync(temp, this.file);
  }
  set(config: unknown): string | undefined {
    if (!validAppearanceConfig(config)) return 'Choose at least one category and at least one character when Fictional is enabled.';
    const previous = { state: this.state(), slots: { ...this.slots }, known: { ...this.known }, next: this.nextFictional };
    const hadFictional = this.current.config.categories.includes('fictional');
    this.current.config = structuredClone(config);
    // Enabling Fictional applies to existing workers in creation order, starting with Original in mixed mode.
    if (!hadFictional && config.categories.includes('fictional')) { this.slots = {}; this.nextFictional = false; }
    this.allocate();
    try { this.save(); } catch { this.current = previous.state; this.slots = previous.slots; this.known = previous.known; this.nextFictional = previous.next; return 'Could not save worker appearances.'; }
    this.publish(this.state());
  }
  reconcile() {
    if (!this.active) return;
    const before = JSON.stringify({ ...this.current, known: this.known, slots: this.slots });
    this.allocate();
    if (before === JSON.stringify({ ...this.current, known: this.known, slots: this.slots })) return;
    try { this.save(); } catch (err) { console.error('Could not persist worker appearances', err); }
    this.publish(this.state());
  }
  private allocate() {
    const live = this.workers();
    const liveIds = new Set(live.map(w => w.id));
    const workers = [...live, ...Object.values(this.known).filter(w => !liveIds.has(w.id) && this.reserved(w))]
      .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id));
    const ids = new Set(workers.map(w => w.id));
    for (const id of Object.keys(this.current.assignments)) if (!ids.has(id)) { delete this.current.assignments[id]; delete this.slots[id]; delete this.known[id]; }
    const { categories, characters } = this.current.config;
    const fictional = categories.includes('fictional');
    const mixed = fictional && categories.includes('original');
    const used = new Set<string>();
    for (const w of workers) {
      this.known[w.id] = { id: w.id, createdAt: w.createdAt, floor: w.floor };
      if (!(w.id in this.slots)) { this.slots[w.id] = mixed ? this.nextFictional : fictional; if (mixed) this.nextFictional = !this.nextFictional; }
      const wants = fictional && (!mixed || this.slots[w.id]);
      const old = this.current.assignments[w.id];
      if (wants && old && old !== 'original' && characters.includes(old) && !used.has(old)) used.add(old);
      else this.current.assignments[w.id] = 'original';
    }
    for (const w of workers) {
      if (!fictional || (mixed && !this.slots[w.id]) || this.current.assignments[w.id] !== 'original') continue;
      const next = characters.find(id => !used.has(id));
      if (next) { this.current.assignments[w.id] = next; used.add(next); }
    }
  }
}
