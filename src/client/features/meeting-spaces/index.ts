import { MEETING_SPACE_NAVIGATION } from '../../ui/meeting-space-navigation';
import './style.css';
import type { Ctx } from '../../core/context';
import { store } from '../../state';
import { selectMeetingSpace } from '../../shared/meeting-spaces/state';
import { MEETING_WINDOW_EXTENSIONS } from '../../ui/meeting-extensions';
import { h, toast } from '../../ui/dom';
import { spaceName, spaceStatus } from '../../../shared/meeting-spaces';

export function installMeetingSpaces(_ctx: Ctx) {
  MEETING_WINDOW_EXTENSIONS.push({
    command: msg => msg.t === 'meeting.finish' ? msg : { ...msg, spaceId: store.selectedMeetingSpace },
    mount(net, switched) {
      const select = h('select', { 'aria-label': 'Meeting space' });
      const current = h('span.meeting-space-current');
      const navigate = h('button.btn.meeting-portal-launch', { type: 'button', onclick: () => MEETING_SPACE_NAVIGATION.open?.() }, 'Reality Anchor');
      const attention = h('span.meeting-space-attention', { role: 'status' });
      const name = h('input', { type: 'text', maxlength: 60, placeholder: 'Name your meeting space', 'aria-label': 'Space name' });
      const editor = h('form.meeting-space-editor', { hidden: true });
      let editing: 'create' | 'rename' = 'create', pending: { name: string; ids: Set<string> } | undefined;
      const refresh = () => {
        const spaces = store.meetingSpaces.spaces;
        if (!spaces) { element.hidden = true; return; }
        element.hidden = false;
        current.textContent = spaces.find(s => s.id === store.selectedMeetingSpace)?.name ?? '';
        navigate.hidden = !MEETING_SPACE_NAVIGATION.open;
        navigate.textContent = MEETING_SPACE_NAVIGATION.label ?? 'Switch space';
        if (pending) {
          const created = spaces.find(s => s.name === pending!.name && !pending!.ids.has(s.id));
          if (created) { pending = undefined; selectMeetingSpace(store, created.id); switched(); }
        }
        const options = spaces.map(s => ({ id: s.id, label: `${s.name} · ${spaceStatus(s, store.workers.values())}` }));
        const signature = JSON.stringify(options);
        if (select.dataset.signature !== signature) {
          select.replaceChildren(...options.map(s => h('option', { value: s.id }, s.label)));
          select.dataset.signature = signature;
        }
        select.value = store.selectedMeetingSpace;
        const other = spaces.filter(s => s.id !== store.selectedMeetingSpace && spaceStatus(s, store.workers.values()) === 'Needs attention');
        attention.textContent = other.length ? `${other.length} other space${other.length === 1 ? '' : 's'} need${other.length === 1 ? 's' : ''} attention` : '';
        attention.title = other.map(s => s.name).join(', ');
      };
      select.addEventListener('change', () => { editor.hidden = true; name.value = ''; pending = undefined; selectMeetingSpace(store, select.value); switched(); });
      const edit = (mode: typeof editing) => {
        editing = mode; editor.hidden = false;
        name.value = mode === 'rename' ? store.meetingSpaces.spaces?.find(s => s.id === store.selectedMeetingSpace)?.name ?? '' : '';
        name.focus();
      };
      editor.append(name, h('button.btn', { type: 'submit' }, 'Save'), h('button.btn', { type: 'button', onclick: () => { editor.hidden = true; name.value = ''; } }, 'Cancel'));
      editor.addEventListener('submit', event => {
        event.preventDefault(); const clean = spaceName(name.value);
        if (!clean) { toast('Give the space a name of 1–60 characters', 'warn'); name.focus(); return; }
        if (editing === 'create') { pending = { name: clean, ids: new Set(store.meetingSpaces.spaces?.map(s => s.id)) }; net.send({ t: 'meeting-space.create', name: clean }); }
        else net.send({ t: 'meeting-space.rename', id: store.selectedMeetingSpace, name: clean });
        editor.hidden = true;
      });
      const element = h('section.meeting-spaces', { 'aria-label': 'Meeting spaces' },
        h('div.meeting-space-controls', {}, current, navigate, h('details.meeting-space-quick', {}, h('summary', {}, 'Instant switch'), h('label', {}, 'Meeting space', select)),
          h('button.btn', { type: 'button', onclick: () => edit('create') }, '+ New space'),
          h('button.btn', { type: 'button', onclick: () => edit('rename') }, 'Rename')),
        editor, attention,
        h('p', {}, 'Switch freely. Other meetings keep working. A new space starts only when you call a meeting.'));
      refresh(); return { element, refresh };
    },
  });
}
