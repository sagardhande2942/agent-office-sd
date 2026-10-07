// A browser-local draft for delayed remote terminals. The PTY remains authoritative.
import { h } from '../dom';
import './style.css';

const drafts = new Map<string, string>();
export function remoteTerminalDraft(workerId: string, insert: (text: string, submit: boolean) => boolean) {
  const text = h('textarea', { rows: 2, maxlength: 16000, 'aria-label': 'Local terminal draft',
    placeholder: 'Type here without network lag…', spellcheck: 'false', autocomplete: 'off' }) as HTMLTextAreaElement;
  text.value = drafts.get(workerId) ?? '';
  const paste = h('button.btn', { type: 'button', title: 'Paste into the current terminal input without pressing Enter' }, 'Insert');
  const send = h('button.btn.primary', { type: 'submit' }, 'Send ↵');
  const note = h('small', {}, 'Local typing · Enter sends · Shift+Enter adds a line. Sends to the current terminal input; use the terminal for menus, shortcuts and hidden input.');
  const element = h('form.remote-terminal-draft', {}, h('label', {}, 'Local typing', text), h('div.remote-terminal-actions', {}, note, paste, send));
  let enabled = false;
  const remember = () => {
    if (!drafts.has(workerId) && drafts.size >= 30) drafts.delete(drafts.keys().next().value!);
    if (text.value) drafts.set(workerId, text.value); else drafts.delete(workerId);
  };
  const deliver = (submit: boolean) => {
    if (!enabled || !text.value) return;
    if (!insert(text.value, submit)) return;
    text.value = ''; remember(); text.focus();
  };
  text.addEventListener('input', remember);
  text.addEventListener('keydown', e => {
    if (e.key !== 'Enter' || e.shiftKey || e.isComposing || e.ctrlKey || e.altKey || e.metaKey) return;
    e.preventDefault(); deliver(true);
  });
  element.addEventListener('submit', e => { e.preventDefault(); deliver(true); });
  paste.addEventListener('click', () => deliver(false));
  return { element, focus: () => text.focus(), update(on: boolean) {
    enabled = on; paste.toggleAttribute('disabled', !on); send.toggleAttribute('disabled', !on);
    note.textContent = on ? 'Local typing · Enter sends · Shift+Enter adds a line. Sends to the current terminal input; use the terminal for menus, shortcuts and hidden input.' : 'Waiting for the terminal connection. Your draft stays in this browser until you send it.';
  } };
}
