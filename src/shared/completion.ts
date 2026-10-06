export interface CompletionCheck { name: string; status: 'passed' | 'failed' | 'skipped'; evidence: string }
export interface CompletionReport {
  revision: number;
  summary: string;
  checks: CompletionCheck[];
  files: string[];
  filesNote?: string;
  pr?: string;
  prNote?: string;
  commit?: string;
  branch?: string;
  task?: string;
  submittedAt: number;
  status: 'ready' | 'needs-attention';
}
export function completionLabel(report?: CompletionReport): string {
  return !report ? 'Checklist missing' : report.status === 'ready' ? 'Checklist ready · worker reported' : 'Checklist needs attention';
}
