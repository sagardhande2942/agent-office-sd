import { h, openModal, type Modal } from '../../ui/dom';
import type { MeetingSpace } from '../../../shared/meeting-spaces';
import { spaceStatus } from '../../../shared/meeting-spaces';
import { MEETING_PATTERNS, meetingStage } from '../../../shared/meetings';
import type { WorkerInfo } from '../../../shared/protocol';
import { realityColor } from './logic';
export interface AnchorActions {
  move(direction: number): void;
  choose(id: string): void;
  doorway(instant: boolean): void;
  enter(instant: boolean): void;
  create(name: string): void;
  close(): void;
}
/** A destination dial, not a second meeting controller. Looking never changes selection or starts work. */
export class AnchorWindow {
  readonly canvas = h('canvas', { width: 384, height: 480, role: 'img', 'aria-label': 'Live destination meeting preview' });
  readonly modal: Modal;
  private name = h('h2');
  private number = h('span.reality-index');
  private status = h('span.reality-status');
  private stage = h('p.reality-stage');
  private crew = h('div.reality-crew');
  private excerpt = h('p.reality-excerpt');
  private routes = h('div.reality-routes', { 'aria-label': 'Meeting realities' });
  private enter = h('button.reality-primary', { type: 'button' }, 'Open doorway');
  private instant = h('input', { type: 'checkbox', id: 'reality-instant' });
  private form = h('form.reality-create', { hidden: true });
  private input = h('input', { type: 'text', maxlength: 60, placeholder: 'Name this meeting reality', 'aria-label': 'New reality name' });
  private el: HTMLElement;
  private routeKey = '';
  constructor(private actions: AnchorActions, reduced: boolean) {
    this.instant.checked = reduced;
    const preview = h('div.reality-viewport', {}, h('div.reality-orbit.orbit-a'), h('div.reality-orbit.orbit-b'), h('div.reality-aperture', {}, this.canvas), h('span.reality-live', {}, 'LIVE DESTINATION'));
    const previous = h('button.reality-dial', { type: 'button', 'aria-label': 'Previous reality', onclick: () => actions.move(-1) }, '‹');
    const next = h('button.reality-dial', { type: 'button', 'aria-label': 'Next reality', onclick: () => actions.move(1) }, '›');
    const close = h('button.reality-close', { type: 'button', 'aria-label': 'Close Reality Anchor' }, '✕');
    this.form.append(this.input, h('button.reality-secondary', { type: 'submit' }, 'Create reality'), h('button.reality-text', { type: 'button', onclick: () => { this.form.hidden = true; } }, 'Cancel'));
    this.form.addEventListener('submit', event => { event.preventDefault(); actions.create(this.input.value); });
    this.enter.onclick = () => actions.doorway(this.instant.checked);
    this.el = h('section.modal.reality-window', { role: 'dialog', 'aria-label': 'Reality Anchor', tabindex: -1 },
      h('header.reality-header', {}, h('div', {}, h('span.reality-eyebrow', {}, 'MEETING ROOM / REALITY ANCHOR'), h('p', {}, 'Same room. Another reality.')), close),
      h('div.reality-body', {}, h('div.reality-lens', {}, preview, h('div.reality-dial-row', {}, previous, this.number, next)),
        h('div.reality-destination', {}, h('div.reality-meta', {}, h('span', {}, 'DESTINATION'), this.status), this.name, this.stage, this.crew, this.excerpt,
          h('p.reality-rule', {}, 'Preview freely. Your current meeting keeps working until you cross.'),
          h('div.reality-actions', {}, this.enter, h('button.reality-secondary', { type: 'button', onclick: () => actions.enter(this.instant.checked) }, 'Enter now')),
          h('label.reality-motion', {}, this.instant, ' Instant transition'), h('p.reality-footnote', {}, 'Walking through the doorway changes only your view. Other people stay in their reality.'))),
      h('footer.reality-footer', {}, this.routes, h('button.reality-new', { type: 'button', onclick: () => { this.form.hidden = !this.form.hidden; if (!this.form.hidden) this.input.focus(); } }, '+ New reality'), this.form));
    this.el.addEventListener('keydown', event => {
      if ((event.target as HTMLElement).matches('input')) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); actions.move(event.key === 'ArrowLeft' ? -1 : 1); }
    });
    this.modal = openModal(this.el, { closeButton: false, doing: 'at the Reality Anchor', onClose: actions.close });
    close.onclick = () => this.modal.close(); this.el.focus();
  }
  refresh(spaces: readonly MeetingSpace[], target: MeetingSpace, selected: string, workers: ReadonlyMap<string, WorkerInfo>, physical: boolean) {
    this.el.style.setProperty('--reality-color', realityColor(target.id));
    this.name.textContent = target.name;
    this.number.textContent = `${String(spaces.findIndex(s => s.id === target.id) + 1).padStart(2, '0')} / ${String(spaces.length).padStart(2, '0')}`;
    const status = spaceStatus(target, workers.values()); this.status.textContent = target.id === selected ? 'YOU ARE HERE' : status.toUpperCase(); this.status.dataset.attention = String(status === 'Needs attention');
    const m = target.current;
    this.stage.textContent = m ? `${MEETING_PATTERNS[m.pattern].label} · ${m.title} · ${meetingStage(m)}` : 'An unwritten reality. No agents, no work started.';
    this.crew.replaceChildren(...(m?.seats ?? []).map(seat => {
      const worker = seat.workerId ? workers.get(seat.workerId) : undefined;
      return h('span.reality-agent', { title: `${worker?.name ?? seat.workerName ?? seat.role} · ${seat.role} · ${worker?.status ?? 'away'}` }, h('i', { style: `background:${worker?.color ?? '#62718a'}` }, (worker?.name ?? seat.role).slice(0, 1)), seat.role);
    }));
    this.excerpt.textContent = m?.preview?.replace(/[#*`]/g, '').slice(0, 230) ?? (m ? m.status === 'running' ? 'The destination is working. Its output will appear here.' : 'This meeting has ended. No output preview is available.' : 'A quiet table, waiting for your next idea. Create a meeting here when you are ready.');
    this.enter.disabled = !physical || target.id === selected; this.enter.title = physical ? 'Open a walk-through portal beside the meeting room' : 'Use Enter now on this map';
    const key = spaces.map(s => `${s.id}|${s.name}|${spaceStatus(s, workers.values())}`).join(';') + target.id;
    if (this.routeKey !== key) {
      this.routeKey = key;
      const focused = this.routes.contains(document.activeElement) ? document.activeElement?.getAttribute('aria-label') : undefined;
      this.routes.replaceChildren(...spaces.map(space => h('button.reality-route', { type: 'button', title: `${space.name} · ${spaceStatus(space, workers.values())}`, 'aria-label': `Preview ${space.name}`, 'aria-pressed': String(space.id === target.id), style: `--route-color:${realityColor(space.id)}`, onclick: () => this.actions.choose(space.id) }, h('span'), space.name)));
      if (focused) [...this.routes.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === focused)?.focus({ preventScroll: true });
    }
  }
  created() { this.form.hidden = true; this.input.value = ''; }
}
