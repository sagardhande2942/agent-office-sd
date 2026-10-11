import test from 'node:test';
import assert from 'node:assert/strict';

// The hire dialog keeps its worktree choice in localStorage, so stand one in before the module reads it.
const storage = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  configurable: true,
  value: {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => void storage.set(k, String(v)),
    removeItem: (k: string) => void storage.delete(k),
  },
});

// Enough of a page for the dialog to build itself in (openAsk only makes elements and a form).
function browser(t: { after(fn: () => void): void }) {
  // h() tells text from element with `c instanceof Node`, so the elements it makes answer to it.
  class StubNode {}
  const element = (name: string): any => {
    const kids: any[] = [];
    const el: any = Object.assign(new StubNode(), {
      tagName: name.toUpperCase(),
      className: '',
      children: kids,
      style: {},
      attributes: {} as Record<string, string>,
      hidden: false,
      classList: {
      // declared after the element so it can write className
        toggle: (name: string, on?: boolean) => {
          const has = el.className.split(' ').filter(Boolean).includes(name);
          const next = on ?? !has;
          const classes = el.className.split(' ').filter((c: string) => c && c !== name);
          el.className = next ? [...classes, name].join(' ') : classes.join(' ');
          return next;
        },
        add: (name: string) => (el.className = el.className ? `${el.className} ${name}` : name),
        remove: (name: string) => (el.className = el.className.split(' ').filter((c: string) => c && c !== name).join(' ')),
        contains: (name: string) => el.className.split(' ').includes(name),
      },
      textContent: '',
      setAttribute(k: string, v: string) {
        el.attributes[k] = v;
      },
      getAttribute: (k: string) => el.attributes[k] ?? null,
      append(...cs: any[]) {
        kids.push(...cs);
      },
      removeChild: (c: any) => kids.splice(kids.indexOf(c), 1),
      remove() {},
      addEventListener() {},
      removeEventListener() {},
      querySelector: (sel: string) => findAll(el, sel)[0] ?? null,
      querySelectorAll: (sel: string) => findAll(el, sel),
      closest: () => null,
      focus() {},
      setSelectionRange() {},
      contains: () => false,
    });
    return el;
  };
  const matches = (el: any, sel: string) => {
    const [tag, ...classes] = sel.replace(/^[#.]/, '').split('.');
    if (sel.startsWith('#')) return el.id === sel.slice(1) || el.attributes.id === sel.slice(1);
    return (!tag || el.tagName === tag.toUpperCase()) && classes.every((c) => el.className.split(' ').includes(c));
  };
  function findAll(root: any, sel: string): any[] {
    const out: any[] = [];
    for (const kid of root.children ?? []) {
      if (!kid?.tagName) continue; // text
      if (matches(kid, sel)) out.push(kid);
      out.push(...findAll(kid, sel));
    }
    return out;
  }
  const body = element('body');
  const modalRoot = element('div');
  modalRoot.id = 'modal-root';
  const document: any = {
    body,
    createElement: element,
    createElementNS: (_ns: string, name: string) => element(name),
    getElementById: (id: string) => (id === 'modal-root' ? modalRoot : null),
    addEventListener() {},
    removeEventListener() {},
  };
  const previous = {
    document: Object.getOwnPropertyDescriptor(globalThis, 'document'),
    Node: Object.getOwnPropertyDescriptor(globalThis, 'Node'),
    window: Object.getOwnPropertyDescriptor(globalThis, 'window'),
  };
  Object.defineProperty(globalThis, 'document', { configurable: true, writable: true, value: document });
  Object.defineProperty(globalThis, 'Node', { configurable: true, writable: true, value: StubNode });
  Object.defineProperty(globalThis, 'window', { configurable: true, writable: true, value: { addEventListener() {}, removeEventListener() {}, innerWidth: 1280, innerHeight: 720 } });
  t.after(() => {
    for (const name of ['document', 'Node', 'window'] as const) {
      if (previous[name]) Object.defineProperty(globalThis, name, previous[name]!);
      else Reflect.deleteProperty(globalThis, name);
    }
  });
  return { document, modalRoot, findAll };
}

test('a new worker gets a worktree of its own until someone unticks it', async () => {
  const { rememberWorktreePref, worktreePref } = await import('../src/client/ui/prompt.js');
  assert.equal(worktreePref(), true, 'no choice made yet: the box opens ticked');
  rememberWorktreePref(true);
  assert.equal(worktreePref(), true);
  rememberWorktreePref(false);
  assert.equal(worktreePref(), false, 'an unticked box sticks for the next hire');
  rememberWorktreePref(true);
  assert.equal(worktreePref(), true);
});

test('the Ask window opens it ticked on the first hire, and unticked once someone has', async (t) => {
  const { modalRoot, findAll } = browser(t);
  const { openAsk } = await import('../src/client/ui/ask.js');
  const { rememberWorktreePref, worktreePref } = await import('../src/client/ui/prompt.js');
  const ask = () => {
    modalRoot.children.length = 0; // the last window, closed
    openAsk({ title: 'Ask a worker', worktreeOption: true, workers: [], onSubmit: () => {} });
    const box = findAll(modalRoot, '#ask-wt')[0] as any;
    assert.ok(box, 'the Ask window offers its own worktree');
    return box.checked;
  };
  storage.delete('agent-office.worktree');
  assert.equal(ask(), true);
  rememberWorktreePref(false);
  assert.equal(ask(), false);
  rememberWorktreePref(true);
  assert.equal(ask(), true);
  assert.equal(worktreePref(), true);
});