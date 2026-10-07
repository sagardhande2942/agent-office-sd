import { REPLAY_TEXT_LIMIT } from '../../shared/task-replay.js';

const MARKER = '\n…[truncated]';
const REDACTED = '[redacted]';
const ESCAPES = new RegExp('[\\u001b\\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-PR-TZcf-nqry=><]*', 'g');
const CONTROLS = new RegExp('[\\u0000-\\u0008\\u000b-\\u001f\\u007f\\u200b-\\u200f\\ufeff]', 'g');
const URL_CREDENTIALS = /\b([a-z][a-z0-9+.-]*:\/\/)([^\s/:@]+):([^\s/@]+)@/gi;
const AUTH_HEADERS = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9._~+/=-]{8,}/gi;
const TOKENS = [
  /\bgh[pousr]_[A-Za-z0-9]{20,}/g,
  /\bgithub_pat_[A-Za-z0-9_]{20,}/g,
  /\bsk-[A-Za-z0-9_-]{16,}/g,
  /\bxox[bapr]-[A-Za-z0-9-]{10,}/g,
  /\bAKIA[0-9A-Z]{16}\b/g,
  /\bglpat-[A-Za-z0-9_-]{16,}/g,
  /\bnpm_[A-Za-z0-9]{36}\b/g,
  /\bdckr_pat_[A-Za-z0-9_-]{20,}/g,
  /\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g,
];
const ASSIGNMENTS = /\b([A-Za-z0-9_.-]*(?:token|secret|passw(?:or)?d|passwd|passphrase|pwd|credential|apikey|api[_-]?key|access[_-]?key|private[_-]?key|secret[_-]?key|client[_-]?secret|session[_-]?key|authorization|signature|session|cookie|bearer|key))\b(\s*"?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s"']*)/gi;
const ENV_ASSIGNMENTS = /\b([A-Z][A-Z0-9]*(?:_[A-Z0-9]+)+)(\s*"?\s*[:=]\s*)("[^"\n]*"|'[^'\n]*'|[^\s"']*)/g;
const ENV_ACCESS = /\bprocess\.env(?:\.[A-Za-z_][A-Za-z0-9_]*|\[[^\]\n]*\])/g;
const ENV_EXPANSION = /\$(?:[A-Z][A-Z0-9_]*\b|\{[A-Za-z_][A-Za-z0-9_]*\})/g;
const ENV_SINGLE = /\b([A-Z][A-Z0-9_]*)(\s*=\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;]+)/g;
const EXPORTS = /\b(export\s+[A-Za-z_][A-Za-z0-9_]*)(\s*=\s*)("[^"\n]*"|'[^'\n]*'|[^\s,;]+)/g;
const PRIVATE_KEYS = /-----BEGIN (?:[A-Z0-9]+ )*PRIVATE KEY-----[\s\S]*?(?:-----END (?:[A-Z0-9]+ )*PRIVATE KEY-----|$)/g;
const FLAGS = /--([A-Za-z][A-Za-z0-9_-]*)([ =]+)("[^"\n]*"|'[^'\n]*'|[^\s"']+)/g;
const CREDENTIAL_END = /(token|secret|password|passwd|passphrase|pwd|credential|apikey|accesskey|privatekey|secretkey|clientsecret|sessionkey|authorization|signature|signing|session|cookie|bearer|key)$/;

export function credentialName(name: string): boolean {
  return CREDENTIAL_END.test(name.toLowerCase().replace(/[-_]/g, ''));
}

export function recordedText(value: unknown): { text: string; truncated: boolean } {
  let text = typeof value === 'string' ? value : String(value ?? '');
  text = text.replace(ESCAPES, '').replace(CONTROLS, '').replace(PRIVATE_KEYS, REDACTED);
  text = text
    .replace(URL_CREDENTIALS, `$1${REDACTED}@`)
    .replace(AUTH_HEADERS, `$1 ${REDACTED}`);
  for (const pattern of TOKENS) text = text.replace(pattern, REDACTED);
  text = text
    .replace(ASSIGNMENTS, `$1$2${REDACTED}`)
    .replace(ENV_ASSIGNMENTS, `$1$2${REDACTED}`)
    .replace(ENV_SINGLE, `$1$2${REDACTED}`)
    .replace(EXPORTS, `$1$2${REDACTED}`)
    .replace(ENV_ACCESS, `process.env${REDACTED}`)
    .replace(ENV_EXPANSION, `$${REDACTED}`)
    .replace(FLAGS, (match, name, separator) => (credentialName(name) ? `--${name}${separator}${REDACTED}` : match));
  text = text.trim();
  const truncated = text.length > REPLAY_TEXT_LIMIT;
  if (truncated) text = text.slice(0, REPLAY_TEXT_LIMIT - MARKER.length) + MARKER;
  return { text, truncated };
}

export function shorten(value: string, max = 160): string {
  const one = value.replace(/\s+/g, ' ').trim();
  return one.length <= max ? one : `${one.slice(0, max - 1)}…`;
}
