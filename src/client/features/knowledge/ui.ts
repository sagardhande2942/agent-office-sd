import './ui.css';
import type { Net } from '../../net';
import { store } from '../../state';
import { h, openModal, toast } from '../../ui/dom';
import { markdownFile } from '../../ui/markdown';
import { parseKnowledgeNote, type KnowledgeFrontmatter } from '../../../shared/knowledge-index';
export function openKnowledge(opts: { net: Net; onUseInPrompt?: (text: string) => void }) {
  const { net } = opts;
  let handovers = false; let query = ''; let selected = ''; let parsed: ReturnType<typeof parseKnowledgeNote> | null = null;
  const left = h('nav.knowledge-tree', { 'aria-label': 'Knowledge tree' });
  const right = h('article.knowledge-note'); const branch = h('span.knowledge-branch');
  const search = h('input', { type: 'search', placeholder: 'Search knowledge…', 'aria-label': 'Search knowledge' }) as HTMLInputElement;
  const commit = h('button.btn', { onclick: () => net.send({ t: 'knowledge.commit', title: parsed?.frontmatter.title ?? 'knowledge' }) }, 'Publish review');
  const reviews = h('div.knowledge-reviews', { 'aria-label': 'Knowledge reviews' });
  const body = h('div.knowledge-columns', {}, left, right);
  const modalEl = h('div.modal.knowledge-window', { role: 'dialog', 'aria-label': 'Knowledge' },
    h('header', {}, h('h2', {}, '📜 Knowledge'), branch),
    h('div.body', {}, h('div.knowledge-toolbar', {}, search,
      h('button.btn', { onclick: () => { handovers = false; renderTree(); } }, 'Knowledge'),
      h('button.btn', { onclick: () => { handovers = true; renderTree(); } }, 'Handovers'),
      h('button.btn', { onclick: () => edit() }, 'Add note'), commit, h('button.btn', { onclick: () => net.send({ t: 'knowledge.sync' }) }, 'Sync approved')), reviews, body));
  const offs: (() => void)[] = [];
  const modal = openModal(modalEl, { reading: true, onClose: () => offs.forEach(off => off()) });
  function read(path: string, journal = false) { selected = path; net.send({ t: 'knowledge.read', path, handover: journal }); }
  function renderTree() {
    branch.textContent = `${store.knowledge.branch || 'branch unknown'}${store.knowledge.uncommitted ? ' · uncommitted' : ''}`;
    const deliveries = store.knowledge.deliveries ?? [];
    commit.disabled = deliveries.some(d => d.state === 'preparing' || d.state === 'published');
    reviews.replaceChildren(...deliveries.slice(-5).map(d => h('p', {},
      `${d.state}${d.conflicts?.length ? ' - needs reconciliation: ' + d.conflicts.join(', ') : ''} `,
      ...(d.url ? [h('a', { href: d.url, target: '_blank', rel: 'noopener noreferrer' }, 'Review changes')] : []), d.error ?? '')));
    if (handovers) { left.replaceChildren(...store.knowledge.handovers.map(n => h('button.knowledge-row', { onclick: () => read(n.path, true) }, n.title))); return; }
    const rows = [...store.knowledge.rows].sort((a, b) => a.path.localeCompare(b.path));
    left.replaceChildren(...rows.filter(n => !query || `${n.path} ${n.title} ${n.tags.join(' ')}`.toLowerCase().includes(query.toLowerCase())).map(n => {
      const depth = n.path.split('/').length - 1;
      return h('button.knowledge-row', { style: `padding-left:${12 + depth * 14}px`, onclick: () => { if (!n.directory) read(n.path); else { right.replaceChildren(h('h3', {}, n.title), h('p', {}, n.summary)); } } },
        h('span', {}, n.directory ? '📁 ' + n.title : n.title), h('small', {}, n.path), h('span.knowledge-badge', { class: n.status }, n.error ? '⚠ ' + n.error : n.status));
    }));
  }
  function renderNote() {
    const note = store.knowledgeNote; if (!note || note.path !== selected) return;
    parsed = null;
    if (!note.handover) {
      try { parsed = parseKnowledgeNote(note.text); }
      catch (e) { right.replaceChildren(h('p', {}, '⚠ ' + (e as Error).message), h('pre', {}, note.text)); return; }
    }
    const content = markdownFile(parsed?.body ?? note.text);
    const actions = h('div.knowledge-toolbar');
    if (note.handover) actions.append(h('button.btn', { onclick: () => edit(undefined, note.text) }, 'Promote to knowledge'));
    else {
      actions.append(h('button.btn', { onclick: () => edit(parsed!.frontmatter, parsed!.body, note.path, note.version) }, 'Edit'));
      actions.append(h('button.btn', { onclick: () => {
        const text = `Read project knowledge at ${note.path} using knowledge_read({path: ${JSON.stringify(note.path)}}).`;
        if (opts.onUseInPrompt) { opts.onUseInPrompt(text); modal.close(); } else { void navigator.clipboard.writeText(text); toast('Copied knowledge path'); }
      } }, 'Use in prompt'));
      actions.append(h('button.btn', { onclick: () => net.send({ t: 'knowledge.history', path: note.path }) }, 'History'));
      actions.append(h('button.btn', { onclick: () => {
        const commit = prompt('Knowledge-only commit to revert:'); if (commit) net.send({ t: 'knowledge.restore', commit });
      } }, 'Propose revert'));
      actions.append(h('button.btn.danger', { onclick: () => { if (confirm(`Delete ${note.path} from shared knowledge?`)) net.send({ t: 'knowledge.delete', path: note.path, expectedVersion: note.version }); } }, 'Delete'));
    }
    right.replaceChildren(h('h3', {}, parsed?.frontmatter.title ?? 'Shift handover'),
      h('p', {}, note.path), h('div', {}, ...(parsed?.frontmatter.tags ?? []).map(tag => h('button.knowledge-badge', { onclick: () => { query = tag; search.value = tag; renderTree(); } }, tag))), actions, content);
  }
  function edit(frontmatter?: KnowledgeFrontmatter, initialBody = '', initialPath = '', expectedVersion?: string) {
    const pathInput = h('input', { value: initialPath, placeholder: 'project/how-to-test.md', required: true, 'aria-label': 'Knowledge path' }) as HTMLInputElement;
    const title = h('input', { value: frontmatter?.title ?? '', required: true, 'aria-label': 'Title' }) as HTMLInputElement;
    const summary = h('input', { value: frontmatter?.summary ?? '', required: true, 'aria-label': 'Summary' }) as HTMLInputElement;
    const tags = h('input', { value: frontmatter?.tags?.join(', ') ?? '', 'aria-label': 'Tags' }) as HTMLInputElement;
    const status = h('select', { 'aria-label': 'Status' }, ...['active', 'needs-verification', 'archived'].map(s => h('option', { value: s }, s))) as HTMLSelectElement;
    status.value = frontmatter?.status ?? 'active';
    const area = h('textarea', { rows: 15, 'aria-label': 'Markdown body' }) as HTMLTextAreaElement; area.value = initialBody;
    const form = h('form.modal.knowledge-editor', { role: 'dialog', 'aria-label': 'Edit knowledge' }, h('header', {}, h('h2', {}, 'Edit knowledge')),
      h('div.body', {}, ...[[pathInput, 'Path'], [title, 'Title'], [summary, 'Summary'], [tags, 'Tags'], [status, 'Status'], [area, 'Markdown']].map(([el, label]) => h('label', {}, label as string, el as HTMLElement))),
      h('footer', {}, h('button.btn.primary', { type: 'submit' }, 'Save')));
    let offSaved = () => {};
    const editor = openModal(form, { onClose: () => offSaved() });
    offSaved = store.on('knowledgeStatus', () => { if (store.knowledgeStatus.message === 'Knowledge updated') editor.close(); });
    form.addEventListener('submit', e => { e.preventDefault(); net.send({ t: 'knowledge.write', path: pathInput.value, frontmatter: { ...frontmatter, title: title.value, summary: summary.value, tags: tags.value.split(',').map(t => t.trim()).filter(Boolean), status: status.value as KnowledgeFrontmatter['status'] }, body: area.value, expectedVersion: pathInput.value === initialPath ? expectedVersion ?? null : null }); });
  }
  search.addEventListener('input', () => { query = search.value; if (query.trim()) net.send({ t: 'knowledge.search', query }); else renderTree(); });
  offs.push(store.on('knowledge', renderTree), store.on('knowledgeNote', renderNote), store.on('knowledgeStatus', () => {
    const status = store.knowledgeStatus;
    if (status.results) left.replaceChildren(...status.results.map(hit => h('button.knowledge-row', { onclick: () => read(hit.path) }, hit.title, h('small', {}, `${hit.path}:${hit.line}`), h('pre', {}, hit.lines.join('\n')))));
    else toast(status.message);
  }));
  renderTree(); net.send({ t: 'knowledge.tree' });
}
