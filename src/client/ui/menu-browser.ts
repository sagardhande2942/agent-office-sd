import { h } from './dom';

interface Entry {
  section: string;
  label(): string;
  pinned(): boolean;
  element: HTMLElement;
}

/** Categories come from registered actions; search always spans the entire menu. */
export function menuBrowser(entries: Entry[]) {
  let category = 'All';
  const search = h('input.menu-search', { type: 'search', placeholder: 'Find an action or setting…', 'aria-label': 'Search office menu' });
  const categories = ['All', 'Pinned', ...new Set(entries.map(entry => entry.section))];
  const tabs = categories.map(name => h('button.menu-filter', {
    type: 'button', onclick: () => { category = name; refresh(); },
  }, name));
  const empty = h('p.menu-empty', { role: 'status' });
  const groups = [...new Set(entries.map(entry => entry.section))].map(name => {
    const members = entries.filter(entry => entry.section === name);
    return { members, element: h('section.menu-group', { 'aria-label': name },
      h('div.menu-sec', {}, name === 'Display' ? 'Show on screen' : name), ...members.map(entry => entry.element)) };
  });
  const list = h('div.menu-results', {}, ...groups.map(group => group.element), empty);
  function refresh() {
    const query = search.value.trim().toLocaleLowerCase();
    let count = 0;
    for (const entry of entries) {
      const matches = query
        ? `${entry.label()} ${entry.section}`.toLocaleLowerCase().includes(query)
        : category === 'All' || (category === 'Pinned' ? entry.pinned() : entry.section === category);
      entry.element.hidden = !matches;
      if (matches) count++;
    }
    for (const group of groups) group.element.hidden = group.members.every(entry => entry.element.hidden);
    tabs.forEach((tab, index) => tab.setAttribute('aria-pressed', String(!query && categories[index] === category)));
    empty.hidden = count > 0;
    empty.textContent = query ? 'No matches. Try another search.' : 'No pinned actions yet. Use the pin beside any action.';
    list.scrollTop = 0;
  }
  search.addEventListener('input', refresh);
  refresh();
  return { search, list, refresh, controls: h('div.menu-controls', {}, search,
    h('nav.menu-filters', { 'aria-label': 'Menu categories' }, ...tabs)) };
}
