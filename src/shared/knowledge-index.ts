/** Portable, deliberately small frontmatter subset: scalars and inline scalar arrays. */
export type KnowledgeStatus = 'active' | 'needs-verification' | 'archived';
export interface KnowledgeFrontmatter {
  title: string; summary: string; tags?: string[]; status?: KnowledgeStatus; pinned?: boolean;
  paths?: string[]; sources?: string[]; author?: string; updated?: string; verified_at?: string;
}
export interface KnowledgeEntry { path: string; summary: string; tags?: string[]; status?: KnowledgeStatus; pinned?: boolean }
export interface KnowledgeIndex { prose: string; entries: KnowledgeEntry[]; archived: KnowledgeEntry[] }
export function parseFrontmatter(text: string): { fields: Record<string, unknown>; body: string } {
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text);
  if (!match) throw Error('Missing YAML frontmatter');
  const fields: Record<string, unknown> = {};
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const pair = /^([a-z_]+):\s*(.*?)\s*$/.exec(line);
    if (!pair || Object.hasOwn(fields, pair[1])) throw Error(`Invalid frontmatter line: ${line}`);
    const value = /^[\["']/.test(pair[2]) ? pair[2] : pair[2].replace(/\s+#.*$/, '');
    if (value.startsWith('[')) {
      if (!value.endsWith(']')) throw Error('Arrays must use inline YAML syntax');
      try { fields[pair[1]] = JSON.parse(value); }
      catch { fields[pair[1]] = value.slice(1, -1).split(',').map(s => s.trim().replace(/^['"]|['"]$/g, '')).filter(Boolean); }
    } else if (value === 'true' || value === 'false') fields[pair[1]] = value === 'true';
    else if (value.startsWith('"')) { try { fields[pair[1]] = JSON.parse(value); } catch { throw Error('Invalid quoted scalar'); } }
    else fields[pair[1]] = value.replace(/^'|'$/g, '').replace(/''/g, "'");
  }
  return { fields, body: text.slice(match[0].length) };
}
export function parseKnowledgeNote(text: string): { frontmatter: KnowledgeFrontmatter; body: string } {
  const { fields, body } = parseFrontmatter(text);
  for (const field of ['title', 'summary']) if (typeof fields[field] !== 'string' || !(fields[field] as string).trim() || /[\r\n]/.test(fields[field] as string)) throw Error(`${field} must be a nonempty single line`);
  if (fields.status !== undefined && !['active', 'needs-verification', 'archived'].includes(String(fields.status))) throw Error('Invalid knowledge status');
  for (const field of ['tags', 'paths', 'sources']) if (fields[field] !== undefined && (!Array.isArray(fields[field]) || (fields[field] as unknown[]).some(v => typeof v !== 'string'))) throw Error(`${field} must be a string array`);
  if (fields.pinned !== undefined && typeof fields.pinned !== 'boolean') throw Error('pinned must be boolean');
  for (const field of ['author', 'updated', 'verified_at']) if (fields[field] !== undefined && typeof fields[field] !== 'string') throw Error(`${field} must be a string`);
  return { frontmatter: { ...fields, status: fields.status ?? 'active' } as unknown as KnowledgeFrontmatter, body };
}
export function serializeFrontmatter(fields: Record<string, unknown>, body: string): string {
  return `---\n${Object.entries(fields).filter(([, v]) => v !== undefined).map(([k, v]) => `${k}: ${JSON.stringify(v)}`).join('\n')}\n---\n${body}`;
}
export function parseKnowledgeIndex(text: string): KnowledgeIndex {
  const { fields } = parseFrontmatter(text);
  if (fields.kind !== 'index' || typeof fields.summary !== 'string' || !fields.summary.trim()) throw Error('Index needs kind: index and summary');
  if (text.split('\n').filter(line => line === '## Entries').length !== 1 || text.split('\n').filter(line => line === '## Archived').length > 1) throw Error('Indexes need exactly one Entries block and at most one Archived block');
  const index: KnowledgeIndex = { prose: '', entries: [], archived: [] };
  let section = '';
  for (const line of text.split('\n')) {
    if (/^## /.test(line)) section = line === '## Entries' ? 'entries' : line === '## Archived' ? 'archived' : '';
    if (line === '## Entries' || line === '## Archived') continue;
    if (!section) { index.prose += `${line}\n`; continue; }
    if (!line.trim()) continue;
    const m = /^- \[([^\]]+)\]\(([^)]+)\) — (.+)$/.exec(line);
    if (!m) throw Error(`Invalid index entry: ${line}`);
    const dir = m[1].endsWith('/');
    if (!dir && !m[1].endsWith('.md')) throw Error('Notes must end in .md');
    if (m[2] !== (dir ? `${m[1]}INDEX.md` : m[1]) || m[1].includes('/') && !dir || !/^[a-zA-Z0-9_. -]+\/?$/.test(m[1]) || ['../', './'].includes(m[1])) throw Error('Index entries must reference immediate children');
    let summary = m[3]; const entry: KnowledgeEntry = { path: m[1], summary: '' };
    summary = summary.replace(/\s+\[(tags: ([^\]]*)|status: ([^\]]*)|pinned)\]/g, (_, token: string, tags: string, status: string) => {
      if (tags !== undefined) entry.tags = tags.split(',').map(s => s.trim()).filter(Boolean);
      if (status !== undefined) { if (!['active', 'needs-verification', 'archived'].includes(status)) throw Error('Invalid index status'); entry.status = status as KnowledgeStatus; }
      if (token === 'pinned') entry.pinned = true;
      return '';
    });
    if (!summary.trim()) throw Error('Index entries need a summary');
    entry.summary = summary;
    (section === 'entries' ? index.entries : index.archived).push(entry);
  }
  if (new Set([...index.entries, ...index.archived].map(e => e.path)).size !== index.entries.length + index.archived.length) throw Error('Duplicate index entry');
  return index;
}
export function serializeKnowledgeIndex(index: KnowledgeIndex): string {
  const block = (entries: KnowledgeEntry[]) => [...entries].sort((a, b) => a.path.localeCompare(b.path, 'en')).map(e => `- [${e.path}](${e.path.endsWith('/') ? `${e.path}INDEX.md` : e.path}) — ${e.summary}${e.tags?.length ? ` [tags: ${e.tags.join(', ')}]` : ''}${e.status && e.status !== 'active' ? ` [status: ${e.status}]` : ''}${e.pinned ? ' [pinned]' : ''}`).join('\n');
  return `${index.prose.trimEnd()}\n\n## Entries\n${index.entries.length ? block(index.entries) + '\n' : ''}${index.archived.length ? `\n## Archived\n${block(index.archived)}\n` : ''}`;
}
