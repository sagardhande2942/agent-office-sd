import type { Game } from './context';
const CODES = ['KeyW', 'KeyA', 'KeyS', 'KeyD', 'ArrowUp', 'ArrowLeft', 'ArrowDown', 'ArrowRight'];
export function installMovement(g: Game) {
  g.keys.add('guard', () => !g.controls() || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(document.activeElement?.tagName ?? ''));
  g.keys.bind({ code: CODES, preventDefault: true, run: e => { g.held.add(e.code); g.walker.path = []; } });
  window.addEventListener('keydown', e => g.keys.handle(e));
  window.addEventListener('keyup', e => g.held.delete(e.code));
  window.addEventListener('blur', () => g.stop());
  document.addEventListener('visibilitychange', () => { if (document.hidden) g.stop(); });
  const down = (...keys: string[]) => keys.some(k => g.held.has(k)) ? 1 : 0;
  g.ticks.add('move', f => {
    if (!g.controls()) return g.stop();
    g.walker.tick(f.dt, down('KeyD', 'ArrowRight') - down('KeyA', 'ArrowLeft'), down('KeyS', 'ArrowDown') - down('KeyW', 'ArrowUp'));
  });
}
