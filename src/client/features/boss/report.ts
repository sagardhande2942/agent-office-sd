import { fmtCost, fmtTokens, type WorkerInfo } from '../../../shared/protocol';
import { analytics } from './logic';

/** Report fields are untrusted text, not Markdown or HTML supplied by an agent. */
export function reportText(value: string): string {
  return value.slice(0, 500).replace(/[\r\n\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, ' ')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/[\\`*_{}\[\]()|#!]/g, '\\$&');
}

export function reportLink(url: string): string | undefined {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return;
    if (u.username || u.password) return;
    return u.href.replace(/[<>"()]/g, (c) => `%${c.charCodeAt(0).toString(16)}`);
  } catch { return; }
}

export function floorReport(floor: string, workers: Iterable<WorkerInfo>, at = new Date()): string {
  const all = [...workers];
  const a = analytics(all);
  const rows = all.map((w) => {
    const url = w.pr && reportLink(w.pr.url);
    const pr = url ? `[#${w.pr!.number}](<${url}>)` : '—';
    return `| ${reportText(w.name)} | ${reportText(w.status)} | ${reportText(w.helper ? `Helping ${w.helper.hostName}` : w.task?.name ?? w.activity ?? w.title ?? '—')} | ${pr} |`;
  });
  return [`# Floor report`, '', `Project: ${reportText(floor)}`, `Generated: ${at.toISOString()}`, '',
    `Workers: ${a.total} · Working: ${a.working} · Needs input: ${a.needs} · Done: ${a.done}`,
    `Reported usage: ${fmtTokens(a.tokens)} tokens · ${fmtCost(a.cost)}`, '',
    '| Worker | Status | Activity | PR |', '| --- | --- | --- | --- |', ...rows, '',
    'Contains current floor metadata; review before sharing. Full prompts and terminal output are not exported.', ''].join('\n');
}

export function downloadReport(text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = `floor-report-${Date.now()}.md`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
