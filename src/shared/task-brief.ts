/** A guided brief: only the author's requirements, never inferred promises. */
export interface TaskBrief {
  original: string;
  goal: string;
  examples: string;
  constraints: string;
  acceptance: string;
  assumptions: string;
  questions: string;
}

export const TASK_BRIEF_MAX = 20_000;

export function briefError(brief: TaskBrief, maxLength = TASK_BRIEF_MAX): string | undefined {
  if (!brief.original.trim()) return 'Enter a rough request first.';
  if (!brief.goal.trim()) return 'Describe the goal.';
  if (!brief.acceptance.trim()) return 'Add at least one observable acceptance criterion.';
  if (formatBrief(brief).length > maxLength) return `Shorten the brief to ${maxLength.toLocaleString('en-US')} characters or fewer.`;
  return undefined;
}

export function formatBrief(brief: TaskBrief): string {
  const sections: [string, string][] = [
    ['Original request', brief.original], ['Goal', brief.goal], ['Examples', brief.examples],
    ['Constraints', brief.constraints], ['Acceptance criteria', brief.acceptance],
    ['Assumptions (confirm before relying on them)', brief.assumptions], ['Open questions', brief.questions],
  ];
  return '# Task brief\n\n' + sections.map(([name, value]) => `## ${name}\n${value.trim() || 'Not specified.'}`).join('\n\n');
}
