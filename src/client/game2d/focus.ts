import type { Game } from './context';
import { doingNow, readingNow, modalOpen, onModalChange, onDoingChange } from '../ui/dom';
export function installFocus(g: Game) {
  const doing = () => g.net.send({ t: 'doing', what: doingNow(), reading: readingNow() });
  onModalChange(open => {
    g.stop(); doing();
    if (!open) queueMicrotask(() => { if (!modalOpen()) g.canvas.focus(); });
  });
  onDoingChange(doing);
  g.messages.on('welcome', doing);
  g.net.onStatus(up => { if (!up) { g.ready = false; g.stop(); } });
  window.addEventListener('pagehide', () => g.net.disconnect());
}
