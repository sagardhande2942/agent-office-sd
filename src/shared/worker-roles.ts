/** Stable role IDs shared by the prompt editor and worker lifecycle feature. */
export const WORKER_ROLES = {
  developer: { name: 'Developer', responsibilities: 'Implement the assigned change within its scope. Follow repository conventions, run relevant checks, and report changed files and remaining risks.' },
  reviewer: { name: 'Reviewer', responsibilities: 'Inspect the assigned code for correctness, security, regressions and maintainability. Report actionable findings with file references and severity. Do not edit files unless the task explicitly requests fixes.' },
  tester: { name: 'Tester', responsibilities: 'Verify acceptance criteria, reproduce failures, and add meaningful regression tests when requested. Report commands, actual results and gaps in coverage. Keep production changes limited to explicitly requested fixes.' },
  researcher: { name: 'Researcher', responsibilities: 'Investigate the assigned question using repository evidence and appropriate sources. Report findings, references, uncertainty and recommendations. Do not change code unless explicitly requested.' },
} as const;
export type WorkerRole = keyof typeof WORKER_ROLES;
export const ROLE_PATTERN = /^\[Office worker role: (developer|reviewer|tester|researcher|none)\]\n?/;
export function roleAssignment(text: string): WorkerRole | 'none' | undefined {
  return ROLE_PATTERN.exec(text)?.[1] as WorkerRole | 'none' | undefined;
}
export function assignRole(text: string, role: WorkerRole | 'none'): string {
  return `[Office worker role: ${role}]\n${text.replace(ROLE_PATTERN, '')}`;
}
export function roleInstructions(role: WorkerRole): string {
  const definition = WORKER_ROLES[role];
  return `WORKER ROLE: ${definition.name}\nResponsibilities: ${definition.responsibilities}\nFollow the user's task and repository instructions. Ask for clarification when the requested scope is unclear. This role guides responsibilities; it does not change permissions.`;
}
