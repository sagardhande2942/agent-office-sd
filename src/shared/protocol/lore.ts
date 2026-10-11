/** A note of tribal knowledge, gotchas, or shift handovers kept on a floor. */
export interface LoreNote {
  id: string;
  title: string;
  content: string;
  author: string;
  workerId?: string;
  desk?: string;
  pr?: {
    number: number;
    url?: string;
  };
  tags: string[];
  createdAt: number;
  updatedAt: number;
}

export type LoreClientMsg =
  | { t: 'lore.list' }
  | {
      t: 'lore.save';
      note: {
        id?: string;
        title: string;
        content: string;
        author: string;
        workerId?: string;
        desk?: string;
        pr?: { number: number; url?: string };
        tags?: string[];
      };
    }
  | { t: 'lore.delete'; id: string };

export type LoreServerMsg =
  | { t: 'lore.all'; notes: LoreNote[] }
  | { t: 'lore.saved'; note: LoreNote }
  | { t: 'lore.deleted'; id: string };
