import type { LoreNote } from './protocol/lore.js';
import { FLOOR } from './layout.js';

export const LORE_TITLE_MAX = 120;
export const LORE_CONTENT_MAX = 10_000;
export const LORE_TAG_MAX = 32;
export const LORE_TAGS_MAX = 8;

/** The 3D Lore Shelf fixture position beside the basketball hoop on the west wall facing into the office. */
export const LORE_SHELF = {
  x: FLOOR.minX + 0.21,
  z: 9,
  width: 1.6,
  depth: 0.36,
  height: 2.1,
} as const;

export function cleanLoreTitle(title: string): string {
  const t = title.replace(/\s+/g, ' ').trim();
  return t.length > LORE_TITLE_MAX ? `${t.slice(0, LORE_TITLE_MAX - 1)}…` : t;
}

export function cleanLoreContent(content: string): string {
  const c = content.replace(/\r\n?/g, '\n').trim();
  return c.length > LORE_CONTENT_MAX ? c.slice(0, LORE_CONTENT_MAX) : c;
}

export function parseLoreTags(raw: string[] | string | undefined): string[] {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : raw.split(/[,\s]+/);
  const out = new Set<string>();
  for (const tag of list) {
    const clean = tag.replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase().trim();
    if (clean && clean.length <= LORE_TAG_MAX) out.add(clean);
    if (out.size >= LORE_TAGS_MAX) break;
  }
  return [...out];
}

/** Formats one or more lore notes into Markdown suitable for injecting into task briefs or worker prompts. */
export function formatLoreForPrompt(notes: readonly LoreNote[]): string {
  if (!notes.length) return '';
  const lines = ['# Repository lore & shift handover notes', ''];
  for (const n of notes) {
    const authorLine = [
      `Author: ${n.author}`,
      n.desk ? `(${n.desk})` : '',
      n.pr ? `PR #${n.pr.number}` : '',
      `Date: ${new Date(n.createdAt).toISOString().slice(0, 10)}`,
    ]
      .filter(Boolean)
      .join(' · ');
    lines.push(`## ${n.title}`);
    lines.push(`*${authorLine}*`);
    if (n.tags.length) lines.push(`Tags: ${n.tags.map((t) => `#${t}`).join(' ')}`);
    lines.push('');
    lines.push(n.content);
    lines.push('');
  }
  return lines.join('\n').trim();
}

/** The shelf presents reusable knowledge; task records remain available to worker/history tools. */
export function knowledgeShelfNotes(notes: readonly LoreNote[]): LoreNote[] {
  return notes.filter(note => !note.id.startsWith('handover-') && !note.tags.some(tag => tag.toLowerCase() === 'handover')
    && note.curation?.status !== 'archived' && note.curation?.status !== 'superseded');
}
