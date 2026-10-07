import type { Game } from './context';
import { officeNav } from '../../shared/nav';
import { SPAWN } from '../../shared/layout';
import { lastSpot, loadProfile, saveProfile } from '../state';
import { routeTerminalMessage, openTerminalFor } from '../ui/terminal';
import { routeChangesMessage, openChangesFor } from '../ui/changes';
import { routePullMessage } from '../ui/pull';
import { routeWorktreeMessage } from '../ui/prompt';
import { openSignIns } from '../ui/signins';
import { closeAllModals, toast, h, openModal, modalOpen } from '../ui/dom';

export async function bootstrap(g: Game) {
  let bootVersion = '';
  g.messages.onAny(m => { routeTerminalMessage(m); routeChangesMessage(m); routePullMessage(m); routeWorktreeMessage(m); });
  function enter(reconnect: boolean) {
    g.stop(); g.peers.clear(); g.transitioning = false;
    g.walker.nav = officeNav(g.store.floorPlan.wing);
    const saved = lastSpot();
    const peer = g.store.peers.get(g.store.you);
    const at = reconnect && peer ? [peer.x, peer.z] as [number, number] : saved?.floor === g.store.floor && (!saved.map || saved.map === 'office') ? [saved.x, saved.z] as [number, number] : [SPAWN.x, SPAWN.z] as [number, number];
    g.walker.at = g.walker.nav.nearestWalkable(at);
    g.ready = true;
    if (!modalOpen()) g.canvas.focus();
  }
  g.messages.on('welcome', m => {
    if (bootVersion && m.version !== bootVersion) return location.reload();
    bootVersion = m.version; enter(true);
    const terminal = openTerminalFor(); if (terminal && g.store.workers.has(terminal)) g.net.send({ t: 'worker.attach', workerId: terminal });
    const watching = openChangesFor(); if (watching && g.store.workers.has(watching.workerId)) g.net.send({ t: 'changes.watch', ...watching });
  });
  g.messages.on('floor.enter', () => { closeAllModals(); enter(false); });
  g.messages.on('toast', m => { if (g.transitioning) { g.transitioning = false; g.store.emit('floor'); } toast(m.text, m.level); });
  g.messages.on('signins.needed', m => openSignIns(g.net, m.why, m.which));
  g.messages.on('upgrade', m => { if (m.state.phase === 'restarting') g.net.expectRestart(); });
  g.store.on('floorPlan', () => { g.stop(); g.walker.nav = officeNav(g.store.floorPlan.wing); g.walker.at = g.walker.nav.nearestWalkable(g.walker.at); });
  g.store.on('map', () => g.stop());
  g.net.onMessage(m => g.messages.dispatch(m));
  let last = performance.now();
  function frame(now: number) { const delta = (now - last) / 1000; last = now; g.ticks.run({ delta, dt: Math.min(0.1, delta), t: now / 1000, now }); requestAnimationFrame(frame); }
  requestAnimationFrame(frame);
  (window as any).__game2d = g;
  try {
    const res = await fetch('/api/whoami', { cache: 'no-store' });
    if (res.status === 401) return location.assign('/login?next=/2d');
    if (!res.ok) throw Error('Sign-in check failed');
    const { me } = await res.json(); if (me) g.store.me = me;
    if (g.store.me.account) g.store.profile.name = g.store.me.account.name;
    if (loadProfile() || g.store.me.account) g.net.connect();
    else {
      const name = h('input', { maxlength: 24, placeholder: 'Your name', 'aria-label': 'Your name', required: true });
      const form = h('form.modal', {}, h('header', {}, h('h2', {}, 'Who is it?')), h('div.body', {}, name), h('footer', {}, h('button.btn.primary', { type: 'submit' }, 'Enter office')));
      const modal = openModal(form);
      form.addEventListener('submit', e => {
        e.preventDefault(); if (!name.value.trim()) return;
        g.store.profile.name = name.value.trim(); saveProfile({ name: g.store.profile.name, color: g.store.profile.color });
        modal.close(); g.net.connect();
      });
      name.focus();
    }
  } catch { toast('Cannot connect to the office. Reload when the server is available.', 'error'); }
}
