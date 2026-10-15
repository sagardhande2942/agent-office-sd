import type { Ctx } from '../../core/context';
import { selectMeetingSpace } from '../../shared/meeting-spaces/state';
import { store } from '../../state';
import { closeAllModals, h, doingNow } from '../../ui/dom';
import { realityColor } from './logic';
import { realitySound } from './sound';
/** Switch once at the crossing midpoint; floor changes cancel every pending effect. */
export class RealityTransition {
  private timers = new Set<ReturnType<typeof setTimeout>>();
  private effects = new Set<HTMLElement>();
  active = false;
  constructor(private ctx: Ctx) {}
  enter(id: string, instant: boolean, done: () => void) {
    if (this.active || id === store.selectedMeetingSpace || !store.meetingSpaces.spaces?.some(s => s.id === id)) return;
    closeAllModals(); this.active = true;
    const floor = store.floor, map = this.ctx.plan().id;
    const commit = () => {
      if (store.floor !== floor || this.ctx.plan().id !== map || this.ctx.trip() || this.ctx.upTop() || !store.meetingSpaces.spaces?.some(s => s.id === id)) { this.cancel(); return; }
      selectMeetingSpace(store, id); done();
      const space = store.meetingSpaces.spaces!.find(s => s.id === id)!;
      const arrival = h('div.reality-arrival', { role: 'status', 'aria-live': 'polite', style: `--reality-color:${realityColor(id)}` }, h('small', {}, 'MEETING REALITY'), h('strong', {}, space.name));
      document.body.append(arrival); this.effects.add(arrival); this.later(() => { arrival.remove(); this.effects.delete(arrival); }, 2300);
    };
    if (instant || this.ctx.reduceMotion.matches) { commit(); this.active = false; return; }
    this.ctx.sound.recipe(a => realitySound(a, 'cross'));
    const crossing = h('div.reality-crossing.active', { 'aria-hidden': 'true', style: `--reality-color:${realityColor(id)}` });
    document.body.append(crossing); this.effects.add(crossing);
    this.ctx.net.send({ t: 'doing', what: 'crossing a meeting reality' });
    this.later(commit, 180);
    this.later(() => { crossing.remove(); this.effects.delete(crossing); this.active = false; this.ctx.net.send({ t: 'doing', what: doingNow() }); }, 700);
  }
  private later(fn: () => void, delay: number) { const timer = setTimeout(() => { this.timers.delete(timer); fn(); }, delay); this.timers.add(timer); }
  cancel() { if (this.active) this.ctx.net.send({ t: 'doing', what: doingNow() }); this.timers.forEach(clearTimeout); this.timers.clear(); this.effects.forEach(e => e.remove()); this.effects.clear(); this.active = false; }
}
