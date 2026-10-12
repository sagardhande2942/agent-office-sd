import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { KnowledgeStore } from './store.js';
import { loadKnowledgeConfig } from './settings.js';
import { parseFrontmatter } from '../../shared/knowledge-index.js';
import type { KnowledgeTreeView, KnowledgeClientMsg } from '../../shared/protocol/knowledge.js';
export interface KnowledgeSurface { execute(action: KnowledgeClientMsg, author: string): unknown | Promise<unknown> }
export class LocalKnowledge implements KnowledgeSurface {
  constructor(private checkout: string) {}
  execute(action: KnowledgeClientMsg, author: string): unknown {
    const store = new KnowledgeStore(this.checkout, loadKnowledgeConfig(this.checkout)); store.seed();
    const git = (args: string[]) => execFileSync('git', args, { cwd: this.checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
    const journal = path.resolve(this.checkout, store.config.handoversDir);
    new KnowledgeStore(this.checkout, { dir: store.config.handoversDir });
    switch (action.t) {
      case 'knowledge.tree': {
        const rows: KnowledgeTreeView['rows'] = store.tree().map(n => ({ path: n.path, title: n.frontmatter?.title ?? n.path, summary: n.frontmatter?.summary ?? '', status: n.frontmatter?.status ?? 'invalid', tags: n.frontmatter?.tags ?? [], error: n.error }));
        const walk = (dir: string) => {
          const text = store.index(dir); const summary = String(parseFrontmatter(text).fields.summary);
          rows.push({ path: dir, title: dir || 'Knowledge', summary, directory: true, status: 'active', tags: [] });
          for (const item of fs.readdirSync(path.join(store.root, dir), { withFileTypes: true })) if (item.isDirectory() && item.name !== '_meta') walk([dir, item.name].filter(Boolean).join('/'));
        }; walk('');
        return { branch: git(['branch', '--show-current']), rows, uncommitted: !!git(['status', '--porcelain', '--', store.config.dir]), handovers: fs.existsSync(journal) ? fs.readdirSync(journal).filter(p => p.endsWith('.md') && !fs.lstatSync(path.join(journal, p)).isSymbolicLink()).map(p => ({ path: p, title: p })) : [] } satisfies KnowledgeTreeView;
      }
      case 'knowledge.read': {
        if (!action.handover) return store.read(action.path);
        if (!/^[a-zA-Z0-9_.-]+\.md$/.test(action.path)) throw Error('Invalid handover path');
        const file = path.join(journal, action.path); if (fs.lstatSync(file).isSymbolicLink()) throw Error('Journal symlinks forbidden');
        return { path: action.path, text: fs.readFileSync(file, 'utf8'), handover: true };
      }
      case 'knowledge.search': return store.search(action.query);
      case 'knowledge.write': return store.write(action.path, action.frontmatter, action.body, `human:${author}`);
      case 'knowledge.delete': {
        const file = store.resolve(action.path, true); if (!fs.existsSync(file)) throw Error('Note missing');
        // git rm is explicit human intent; indexes are regenerated immediately.
        git(['rm', '--', path.relative(this.checkout, file)]);
        return import('./lint.js').then(({ lintKnowledge }) => lintKnowledge(store, true));
      }
      case 'knowledge.commit': {
        if (git(['diff', '--cached', '--name-only']).split('\n').filter(Boolean).some(p => !p.startsWith(store.config.dir + '/'))) throw Error('Other staged changes must be committed separately');
        git(['add', '--', store.config.dir]);
        if (!git(['diff', '--cached', '--name-only'])) return { message: 'No knowledge changes to commit' };
        return { commit: git(['commit', '-m', `knowledge: edit ${action.title.replace(/[\r\n]/g, ' ')}`]) };
      }
      case 'knowledge.history': return { message: git(['log', '-20', '--format=%h %s', '--', path.relative(this.checkout, store.resolve(action.path))]) };
      case 'knowledge.restore': {
        if (!/^[a-f0-9]{7,40}$/i.test(action.commit)) throw Error('Invalid commit');
        const changed = git(['diff-tree', '--no-commit-id', '--name-only', '-r', action.commit]).split('\n').filter(Boolean);
        if (!changed.length || changed.some(p => !p.startsWith(store.config.dir + '/'))) throw Error('Restore only supports knowledge-only commits');
        if (git(['status', '--porcelain'])) throw Error('Restore needs a clean checkout');
        return { message: git(['revert', '--no-edit', action.commit]) };
      }
    }
  }
}
export class RemoteKnowledge implements KnowledgeSurface {
  constructor(private call: (t: string, body: Record<string, unknown>) => Promise<unknown>) {}
  async execute(action: KnowledgeClientMsg, author: string) {
    const result = await this.call('knowledge.execute', { action, author });
    if (typeof result === 'string') throw Error(result); return result;
  }
}
