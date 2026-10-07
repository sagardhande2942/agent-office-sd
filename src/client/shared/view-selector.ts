import type { Net } from '../net';
import { store } from '../state';
import { rememberFloor } from '../state/persist';
import { h, openModal } from '../ui/dom';

export const VIEWS = [{ path: '/', label: '3D' }, { path: '/2d', label: '2D Game' }, { path: '/lite', label: 'Lite' }] as const;
/** One transport per page; hand the floor over even when local storage is unavailable. */
export function switchView(path: string, net: Net) {
  if (!VIEWS.some(v => v.path === path)) return;
  rememberFloor(store.floor);
  net.disconnect();
  const url = new URL(path, location.origin);
  if (store.floor) url.searchParams.set('floor', store.floor);
  if (path === '/') url.searchParams.set('3d', '1');
  location.assign(url.href);
}
export function viewSelector(net: Net): HTMLElement {
  const select = h('select', { 'aria-label': 'View' }, ...VIEWS.map(v => h('option', { value: v.path }, v.label)));
  select.value = location.pathname === '/lite' ? '/lite' : ['/2d', '/2d.html', '/game2d.html'].includes(location.pathname) ? '/2d' : '/';
  select.addEventListener('change', () => switchView(select.value, net));
  return h('label.view-selector', {}, 'View ', select);
}
export function openViewSelector(net: Net) {
  openModal(h('section.modal', {}, h('header', {}, h('h2', {}, 'Office view')), h('div.body', {}, viewSelector(net))));
}
