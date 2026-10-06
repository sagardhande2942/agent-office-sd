import './completion.css';
import type { WorkerInfo } from '../../shared/protocol';
import type { CompletionReport } from '../../shared/completion';
import { completionLabel } from '../../shared/completion';
import { h } from './dom';

export function renderCompletion(panel: HTMLElement, worker: WorkerInfo) {
  const report = worker.completion;
  panel.classList.toggle('hidden', worker.kind !== 'agent' || !!worker.helper);
  if (worker.kind !== 'agent' || worker.helper) { panel.replaceChildren(); return; }
  renderCompletionReport(panel, report);
}

export function renderCompletionReport(panel: HTMLElement, report?: CompletionReport) {
  const expanded = panel.querySelector('details')?.open;
  let pr: string | undefined;
  try { const url = new URL(report?.pr ?? ''); if (url.protocol === 'https:' && !url.username && !url.password) pr = url.href; } catch {}
  panel.replaceChildren(h('details', {open:expanded}, h('summary', {}, completionLabel(report)),
    ...(report ? [h('p', {}, report.summary), h('small', {}, 'Worker-reported evidence · the office does not independently run these checks.'),
      h('ul', {}, ...report.checks.map((check) => h('li', {}, h('strong', {}, `${check.status.toUpperCase()} · ${check.name}`), h('pre', {}, check.evidence)))),
      h('p', {}, `Changed files: ${report.files.join(', ') || report.filesNote}`),
      ...(report.files.length && report.filesNote ? [h('p', {}, report.filesNote)] : []),
      ...(pr ? [h('a', {href:pr,target:'_blank',rel:'noopener noreferrer'}, 'Open pull request')] : [h('p', {}, `PR: ${report.prNote}`)]),
      ...(report.prNote && report.pr ? [h('p', {}, report.prNote)] : []),
      h('p', {}, [report.branch,report.commit].filter(Boolean).join(' · ')),
      h('small', {}, `Submitted ${new Date(report.submittedAt).toLocaleString()}`)]
      : [h('p', {}, 'No checklist for the current task. A ready terminal does not confirm that the work was checked.')])));
}
