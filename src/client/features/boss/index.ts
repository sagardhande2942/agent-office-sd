import type { Ctx } from '../../core/context';
import type { Parts } from '../../core/parts';
import { store } from '../../state';
import { h } from '../../ui/dom';
import { BossMonitor } from './monitor';
import { openBoss } from './ui';

export function installBoss(ctx: Ctx, parts: Pick<Parts, 'waiting' | 'actions' | 'arcade'>) {
  const monitor = new BossMonitor(ctx.office.bossScreen);
  const refresh = () => monitor.draw(store.workers.values());
  store.on('workers', refresh);
  refresh();
  ctx.ticks.add('play', () => monitor.showGame(parts.arcade.zoomed));
  function showBoss() {
    openBoss({
      send: (id, prompt, guard) => ctx.net.send({ t: 'worker.prompt', workerId: id, prompt, guard }),
      terminal: (id) => parts.waiting.openWorkerTerminal(id),
      sendHome: (id) => parts.actions.killWorker(id),
      game: () => parts.arcade.play(),
      chime: () => ctx.sound.intercom(),
    });
  }
  const count = document.getElementById('worker-count');
  count?.insertAdjacentElement('afterend', h('button.btn.boss-toggle', { type: 'button', onclick: showBoss, title: 'Open Boss Control Center' }, '👔 Boss'));
  return { showBoss };
}
