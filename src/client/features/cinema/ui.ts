import { reelMs, showing, type ReelSummary, type ReelShot } from '../../../shared/cinema';
import { clip, h, openModal, setDoing, timeAgo, type Modal } from '../../ui/dom';
import { store } from '../../state';
import type { Net } from '../../net';
import './ui.css';

// The screening room window: the floor's reels down the side, and the one you're watching beside them
// with its caption. The office keeps which reel is on the screen and how far into it everyone is (see
// shared/cinema.ts), so the window follows the wall rather than keeping a copy of the reel itself.
//
// The window is built once, when it opens, and afterwards only its picture, caption and label change:
// a reel that is playing would otherwise take the buttons out from under the pointer every few seconds.

export interface ScreeningDeps {
  /** The floor whose reels these are, for the shot pictures (see server/cinema.ts). */
  floor(): string;
  /** Where a pull request is on the floor's forge, for a reel to link the one it demonstrates. */
  prUrl?(pr: number): string;
}

export class Screening {
  private modal: Modal | null = null;
  /** The reel open in the window; the one on the screen unless you pick another. */
  private picked = '';
  /** The shot the wall is on, as the office says it is; -1 for nothing on. */
  private onScreen = -1;
  private list: HTMLElement | null = null;
  private picture: HTMLImageElement | null = null;
  private caption: HTMLElement | null = null;
  private count: HTMLElement | null = null;
  private pr: HTMLElement | null = null;
  private live: HTMLElement | null = null;
  private stepBack: HTMLButtonElement | null = null;
  private stepOn: HTMLButtonElement | null = null;
  /** What each part was last given, so nothing is touched that hasn't changed. */
  private drawn = '';
  private rooms = '';

  constructor(
    private readonly net: Net,
    private readonly deps: ScreeningDeps,
  ) {}

  /** E at the screen: the window, on whatever is showing or the newest reel. */
  open() {
    if (this.modal || !store.floor) return;
    if (!store.cinema.reels.length) return this.empty();
    const on = showing(store.cinema);
    this.picked = on?.id ?? store.cinema.reels[0].id;
    this.list = h('div.cinema-reels', { role: 'list' });
    this.stage = h('div.cinema-stage');
    const box = h(
      'div.modal.screening',
      { role: 'dialog', 'aria-label': 'Screening room' },
      h('header', {}, h('h2', {}, '🎬 Screening room')),
      h('div.body', {}, this.list, this.stage),
    );
    this.stage.append(this.player());
    this.modal = openModal(box, {
      reading: true,
      onClose: () => this.closed(),
    });
    setDoing(this.modal, 'in the screening room');
    this.redraw();
  }

  /** Nobody has recorded anything yet: say so, and say how a reel gets there. */
  private empty() {
    const box = h(
      'div.modal.screening-empty',
      { role: 'dialog', 'aria-label': 'Screening room' },
      h('header', {}, h('h2', {}, '🎬 Screening room')),
      h('p', {}, 'No reels yet. When a worker finishes a feature it records a short demonstration of the build — a picture per step, each captioned — and puts it on the wall here with ', h('code', {}, 'office-workers cinema add'), '.'),
    );
    this.modal = openModal(box, { onClose: () => (this.modal = null) });
  }

  private stage!: HTMLElement;

  /** The shot the wall is showing now, so the window can follow it; -1 for nothing on. */
  frame(n: number) {
    if (this.onScreen === n) return;
    this.onScreen = n;
    this.redraw();
  }

  /**
   * Draws the window from the store: the list when the reels change, and the shot when it moves. The
   * controls are never rebuilt, so a reel that is playing can't take a button out from under you.
   */
  redraw() {
    if (!this.modal || !this.list) return;
    const state = store.cinema;
    const reel = state.reels.find((r) => r.id === this.picked) ?? state.reels[0];
    if (!reel) return;
    // With nothing picked in particular, the window follows whatever is on the screen.
    const on = showing(state);
    if (on && !this.picked) this.picked = on.id;
    const rooms = state.reels.map((r) => r.id).join(',');
    if (rooms !== this.rooms) {
      this.rooms = rooms;
      this.list.replaceChildren(...state.reels.map((r) => this.row(r, r.id === reel.id)));
    }
    const frame = Math.min(Math.max(0, this.onScreen), Math.max(0, reel.shots.length - 1));
    const here = this.onScreen >= 0 && on?.id === reel.id;
    const key = `${reel.id}|${frame}|${here}|${reel.shots.length}`;
    if (key === this.drawn) return;
    this.drawn = key;
    for (const row of this.list.children) row.classList.toggle('sel', row.getAttribute('data-reel') === reel.id);
    this.show(reel, reel.shots[frame], here);
  }

  /** The shot itself: its picture, its caption, and the numbers around them. */
  private show(reel: ReelSummary, shot: ReelShot | undefined, here: boolean) {
    if (this.picture) {
      this.picture.src = this.shotUrl(reel);
      this.picture.alt = shot ? shot.caption : reel.title;
      if (shot) {
        this.picture.width = shot.width;
        this.picture.height = shot.height;
      }
    }
    if (this.caption) this.caption.textContent = shot ? shot.caption : '';
    if (this.count) this.count.textContent = `▶ ${Math.max(1, this.onScreen + 1)} / ${reel.shots.length} · ${Math.round(reelMs(reel) / 1000)}s`;
    if (this.pr) {
      this.pr.textContent = reel.pr ? `PR #${reel.pr} ↗` : '';
      const url = reel.pr ? this.deps.prUrl?.(reel.pr) ?? '' : '';
      if (url) this.pr.setAttribute('href', url);
      else this.pr.removeAttribute('href');
    }
    if (this.live) this.live.textContent = here ? 'on the screen now' : '';
    const none = !reel.shots.length;
    if (this.stepBack) this.stepBack.disabled = none;
    if (this.stepOn) this.stepOn.disabled = none;
  }

  /** One reel in the list: what it shows, what it demonstrates, and who recorded it. */
  private row(reel: ReelSummary, selected: boolean) {
    return h(
      'button.reel',
      { type: 'button', role: 'listitem', 'data-reel': reel.id, class: selected ? 'sel' : '', onclick: () => this.pick(reel.id) },
      h('span.reel-title', {}, clip(reel.title, 60)),
      h('span.reel-meta', {}, [reel.pr ? `PR #${reel.pr}` : '', reel.by ?? '', timeAgo(reel.at)].filter(Boolean).join(' · ')),
      h('span.reel-shots', {}, `${reel.shots.length} shot${reel.shots.length === 1 ? '' : 's'}`),
    );
  }

  /** The player: the picture, the caption under it, and the controls for the whole room. */
  private player() {
    this.picture = h('img.cinema-shot', { src: '', alt: '' });
    this.caption = h('p.cinema-caption');
    this.count = h('span.cinema-count');
    this.pr = h('a.cinema-pr', { target: '_blank', rel: 'noopener' });
    this.live = h('span.cinema-live');
    this.stepBack = h('button.btn', { type: 'button', title: 'Back a shot', onclick: () => this.step(-1) }, '◀');
    this.stepOn = h('button.btn', { type: 'button', title: 'On a shot', onclick: () => this.step(1) }, '▶');
    const bar = h(
      'div.cinema-bar',
      {},
      h('button.btn', { type: 'button', onclick: () => this.send({ t: 'cinema.play', reel: this.picked }) }, '▶️ On the screen'),
      h('button.btn', { type: 'button', title: 'Pause where it is', onclick: () => this.send({ t: 'cinema.pause', frame: Math.max(0, this.onScreen) }) }, '⏸️'),
      h('button.btn', { type: 'button', title: 'Turn the screen off', onclick: () => this.send({ t: 'cinema.stop' }) }, '⏹️'),
      this.stepBack,
      this.stepOn,
      this.count,
      this.pr,
      this.live,
    );
    return h('div.cinema-player', {}, this.picture, this.caption, bar);
  }

  /** Jumps the wall a shot along, and puts the reel on the screen so everyone watching sees it move. */
  private step(delta: number) {
    const reel = this.reel();
    const n = reel?.shots.length ?? 0;
    if (!reel || !n) return;
    this.send({ t: 'cinema.play', reel: reel.id, frame: (Math.max(0, this.onScreen) + delta + n) % n });
  }

  private send(msg: Parameters<Net['send']>[0]) {
    this.net.send(msg);
  }

  private pick(id: string) {
    this.picked = id;
    this.rooms = '';
    this.redraw();
  }

  private reel(): ReelSummary | undefined {
    return store.cinema.reels.find((r) => r.id === this.picked) ?? store.cinema.reels[0];
  }

  /** Where the office's copy of the shot is: a PNG on this floor (see http/routes/cinema.ts). */
  private shotUrl(reel: ReelSummary): string {
    const n = Math.min(Math.max(0, this.onScreen), Math.max(0, reel.shots.length - 1));
    return `/api/cinema/shot?floor=${encodeURIComponent(this.deps.floor())}&reel=${encodeURIComponent(reel.id)}&n=${n}`;
  }

  private closed() {
    this.modal = null;
    this.list = null;
    this.picture = this.caption = this.count = this.pr = this.live = this.stepBack = this.stepOn = null;
    this.rooms = '';
    this.drawn = '';
  }
}
