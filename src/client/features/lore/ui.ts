import './ui.css';
import type { Net } from '../../net';
import type { LoreNote } from '../../../shared/protocol/lore';
import { cleanLoreContent, cleanLoreTitle, parseLoreTags, formatLoreForPrompt, knowledgeShelfNotes } from '../../../shared/lore';
import { store } from '../../state';
import { h, openModal, toast, timeAgo } from '../../ui/dom';

export interface LoreShelfOptions {
  net: Net;
  onUseInPrompt?: (text: string) => void;
}

export function openLoreShelf(opts: LoreShelfOptions) {
  const { net, onUseInPrompt } = opts;
  let activeTag = '';
  let query = '';

  const listEl = h('div.lore-shelf-list');
  const tagsEl = h('div.lore-shelf-tags');
  const searchInput = h('input.lore-shelf-search-input', {
    type: 'search',
    placeholder: 'Search knowledge by title, author, gotchas, or tags…',
    'aria-label': 'Search knowledge notes',
  }) as HTMLInputElement;

  const newBtn = h('button.btn.primary', { type: 'button' }, '➕ Add note');

  const header = h(
    'header',
    {},
    h('div', {}, h('h2', {}, '📜 Lore Shelf · Knowledge Base'), h('p.setting-note', { style: 'margin:2px 0 0' }, 'Reusable discoveries, verified fixes, architecture, and build quirks for this project.')),
    h('button.btn.close', { type: 'button', 'aria-label': 'Close' }, '✕'),
  );

  const container = h(
    'div.modal.lore-shelf',
    { role: 'dialog', 'aria-label': 'Lore Shelf' },
    header,
    h(
      'div.body',
      {},
      h('div.lore-shelf-search-bar', {}, searchInput, newBtn),
      tagsEl,
      listEl,
    ),
  );

  const modal = openModal(container);
  header.querySelector('button.close')?.addEventListener('click', () => modal.close());

  function renderTags() {
    const allTags = new Set<string>();
    for (const note of knowledgeShelfNotes(store.lore)) {
      for (const t of note.tags) allTags.add(t);
    }
    const tags = [...allTags].sort();
    tagsEl.replaceChildren(
      h(
        'button.lore-tag-chip',
        {
          type: 'button',
          class: activeTag === '' ? 'active' : '',
          onclick: () => {
            activeTag = '';
            renderNotes();
            renderTags();
          },
        },
        'All',
      ),
      ...tags.map((t) =>
        h(
          'button.lore-tag-chip',
          {
            type: 'button',
            class: activeTag === t ? 'active' : '',
            onclick: () => {
              activeTag = activeTag === t ? '' : t;
              renderNotes();
              renderTags();
            },
          },
          `#${t}`,
        ),
      ),
    );
  }

  function renderNotes() {
    const q = query.toLowerCase().trim();
    const knowledge = knowledgeShelfNotes(store.lore);
    const filtered = knowledge.filter((n) => {
      if (activeTag && !n.tags.includes(activeTag)) return false;
      if (!q) return true;
      return (
        n.title.toLowerCase().includes(q) ||
        n.content.toLowerCase().includes(q) ||
        n.author.toLowerCase().includes(q) ||
        n.tags.some((t) => t.toLowerCase().includes(q))
      );
    });

    if (!filtered.length) {
      listEl.replaceChildren(
        h(
          'div.lore-shelf-empty',
          {},
          knowledge.length === 0
            ? 'No reusable knowledge yet. Workers record discoveries here, or use “➕ Add note” to save a project tip.'
            : 'No notes match your filter.',
        ),
      );
      return;
    }

    listEl.replaceChildren(
      ...filtered.map((note) => {
        const copyBtn = h('button.btn', { type: 'button' }, onUseInPrompt ? '📋 Use in prompt' : '📋 Copy');
        copyBtn.addEventListener('click', () => {
          const text = formatLoreForPrompt([note]);
          if (onUseInPrompt) {
            onUseInPrompt(text);
            modal.close();
          } else {
            void navigator.clipboard?.writeText(text);
            toast('Copied note to clipboard');
          }
        });

        const editBtn = h('button.btn', { type: 'button' }, '✏️ Edit');
        editBtn.addEventListener('click', () => {
          openLoreEditor({ net, initial: note });
        });

        const delBtn = h('button.btn.danger', { type: 'button' }, '🗑');
        delBtn.addEventListener('click', () => {
          if (confirm(`Delete lore note “${note.title}”?`)) {
            net.send({ t: 'lore.delete', id: note.id });
          }
        });

        const metaParts = [
          h('span.lore-badge.author', {}, note.author),
          note.desk ? h('span.lore-badge', {}, note.desk) : null,
          note.pr ? h('span.lore-badge.pr', {}, `PR #${note.pr.number}`) : null,
          h('span', {}, timeAgo(note.createdAt)),
        ].filter(Boolean) as HTMLElement[];

        return h(
          'div.lore-card',
          {},
          h(
            'div.lore-card-header',
            {},
            h('h3.lore-card-title', {}, note.title),
          ),
          h('div.lore-card-meta', {}, ...metaParts),
          h('div.lore-card-content', {}, note.content),
          note.tags.length ? h('div.lore-card-meta', {}, ...note.tags.map((t) => h('span.lore-badge', {}, `#${t}`))) : null,
          h('div.lore-card-actions', {}, delBtn, editBtn, copyBtn),
        );
      }),
    );
  }

  searchInput.addEventListener('input', () => {
    query = searchInput.value;
    renderNotes();
  });

  newBtn.addEventListener('click', () => {
    openLoreEditor({ net });
  });

  const off = store.on('lore', () => {
    if (!container.isConnected) return off();
    renderTags();
    renderNotes();
  });

  renderTags();
  renderNotes();
  setTimeout(() => searchInput.focus(), 30);
}

export interface LoreEditorOptions {
  net: Net;
  initial?: Partial<LoreNote>;
  onSaved?: (note: LoreNote) => void;
}

export function openLoreEditor(opts: LoreEditorOptions) {
  const { net, initial, onSaved } = opts;
  const isEditing = !!initial?.id;

  const titleInput = h('input', {
    type: 'text',
    placeholder: 'e.g. Flaky test in auth or deploy flag needed',
    required: 'true',
    maxlength: 120,
    value: initial?.title || '',
  }) as HTMLInputElement;

  const authorInput = h('input', {
    type: 'text',
    placeholder: 'Author name',
    value: initial?.author || store.profile.name || 'Anonymous',
  }) as HTMLInputElement;

  const tagsInput = h('input', {
    type: 'text',
    placeholder: 'Comma-separated tags (e.g. auth, build, tests)',
    value: initial?.tags?.join(', ') || '',
  }) as HTMLInputElement;

  const contentArea = h('textarea', {
    rows: 6,
    placeholder: 'Write the gotchas, traps, or lessons learned for future workers…',
    required: 'true',
  }) as HTMLTextAreaElement;
  contentArea.value = initial?.content || '';

  const saveBtn = h('button.btn.primary', { type: 'submit' }, isEditing ? 'Save changes' : 'Pin note');
  const cancelBtn = h('button.btn', { type: 'button' }, 'Cancel');

  const header = h(
    'header',
    {},
    h('h2', {}, isEditing ? '✏️ Edit Lore Note' : '📝 New Lore Note'),
    h('button.btn.close', { type: 'button', 'aria-label': 'Close' }, '✕'),
  );

  const form = h(
    'form.modal.lore-editor',
    { role: 'dialog', 'aria-label': isEditing ? 'Edit Lore Note' : 'New Lore Note' },
    header,
    h(
      'div.body',
      {},
      h('div.lore-field', {}, h('label', {}, 'Title'), titleInput),
      h('div.lore-field', {}, h('label', {}, 'Author'), authorInput),
      h('div.lore-field', {}, h('label', {}, 'Tags'), tagsInput),
      h('div.lore-field', {}, h('label', {}, 'Notes / Gotchas'), contentArea),
    ),
    h('footer', {}, cancelBtn, saveBtn),
  ) as HTMLFormElement;

  const modal = openModal(form);
  header.querySelector('button.close')?.addEventListener('click', () => modal.close());
  cancelBtn.addEventListener('click', () => modal.close());

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const title = cleanLoreTitle(titleInput.value);
    const content = cleanLoreContent(contentArea.value);
    if (!title || !content) {
      toast('Title and content are required', 'warn');
      return;
    }
    const note = {
      ...(initial?.id ? { id: initial.id } : {}),
      title,
      content,
      author: authorInput.value.trim() || 'Anonymous',
      ...(initial?.workerId ? { workerId: initial.workerId } : {}),
      ...(initial?.desk ? { desk: initial.desk } : {}),
      ...(initial?.pr ? { pr: initial.pr } : {}),
      tags: parseLoreTags(tagsInput.value),
    };
    net.send({ t: 'lore.save', note });
    modal.close();
    onSaved?.(note as LoreNote);
  });

  setTimeout(() => titleInput.focus(), 30);
}
