// The link rules for the smart speaker's player: what counts as a link at all, and how to say — without
// stopping you trying — that a link is a page rather than a file (see features/speaker/ui.ts).

/** The longest link the player takes, the same ceiling the jukebox puts on a stream. */
const MAX_LENGTH = 2048;

/** The extensions a browser can usually play straight from the address. */
const AUDIO_EXTENSION = /\.(mp3|mpga|m4a|m4b|aac|ogg|oga|opus|wav|flac|weba|webm|m3u8)(?:[?#]|$)/i;

/** Media pages that look like tracks but are web pages: a link there isn't a file the browser can stream. */
const PAGE_HOSTS: readonly (readonly [RegExp, string])[] = [
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'YouTube'],
  [/(^|\.)spotify\.com$/, 'Spotify'],
  [/(^|\.)soundcloud\.com$/, 'SoundCloud'],
  [/(^|\.)bandcamp\.com$/, 'Bandcamp'],
  [/(^|\.)music\.apple\.com$|(^|\.)itunes\.apple\.com$/, 'Apple Music'],
  [/(^|\.)deezer\.com$/, 'Deezer'],
  [/(^|\.)tidal\.com$/, 'TIDAL'],
  [/(^|\.)music\.amazon\.[a-z.]+$/, 'Amazon Music'],
];

/** Whether the address itself names an audio file, rather than a page that plays one. */
export function isDirectAudioLink(raw: string): boolean {
  try {
    return AUDIO_EXTENSION.test(new URL(raw).pathname);
  } catch {
    return false;
  }
}

/** The service `raw` is a page of, or null when it isn't one of the ones known to be pages. */
function pageService(raw: string): string | null {
  let host: string;
  try {
    host = new URL(raw).hostname.toLowerCase();
  } catch {
    return null;
  }
  for (const [pattern, name] of PAGE_HOSTS) if (pattern.test(host)) return name;
  return null;
}

/**
 * Checks a pasted link. The same shape as shared/jukebox.ts's checkStreamUrl: `{url}` once it's a link
 * this player can try, `{error}` with something to show when it can't be one at all.
 */
export function checkAudioUrl(raw: unknown): { url: string } | { error: string } {
  const s = typeof raw === 'string' ? raw.trim() : '';
  if (!s) return { error: 'Paste a direct link to an audio file first' };
  if (s.length > MAX_LENGTH) return { error: 'That link is too long' };
  let u: URL;
  try {
    u = new URL(s);
  } catch {
    return { error: "That isn't a web address. Paste a link that starts with https://" };
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return { error: 'Only http and https links can play here' };
  return { url: u.href };
}

/**
 * What to warn about a link the player will still try: a media page rather than a file, or an address
 * with no audio extension in it. Null when it looks like a direct audio file.
 */
export function audioLinkNote(url: string): string | null {
  const service = pageService(url);
  if (service) return `That's a ${service} page, not a direct audio file: copy a link that ends in .mp3 (or another audio file) instead`;
  if (!isDirectAudioLink(url)) return 'No audio file in that link: it plays only if the address is the file itself';
  return null;
}

/** What a track is called in the player: its file name, tidied up, or else the site it comes from. */
export function trackName(raw: string): string {
  let u: URL;
  try {
    u = new URL(raw);
  } catch {
    return raw.slice(0, 60);
  }
  const last = u.pathname.split('/').filter(Boolean).pop() ?? '';
  const stem = safeDecode(last).replace(/\.[a-z0-9]{1,5}$/i, '').replace(/[_+]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (stem) return stem.length > 60 ? `${stem.slice(0, 59)}…` : stem;
  return u.hostname.replace(/^www\./, '');
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text);
  } catch {
    return text;
  }
}
