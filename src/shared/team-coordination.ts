/** Agent contracts are separate from browser snapshots and orchestration revisions. */
export interface TaskSpecification {
  steps: string[]; references: string[]; decisions: string; exclusions: string;
  verification: string[]; kind: 'implementation' | 'research'; expectedMinutes?: number;
}
export interface TaskProgress {
  sequence: number; at: number; step: string; completed: string; checks: string; next: string; blocker?: string;
}
export interface TaskObservation { at: number; head?: string; paths: string[]; additions?: number; deletions?: number; error?: string; }
export interface TaskAlert {
  id: string; kind: 'unknown' | 'estimate' | 'blocker'; message: string; at: number;
  deliveredAt?: number; clearedAt?: number; response?: string; respondedAt?: number;
}
export interface ResultSnapshot { summary: string; checks: string; commits: string[]; review?: string; }
export interface TeamMetrics { responseBytes: number; masterNotices: number; corrections: number; retries: number; takeovers: number; }
export interface TeamRead { view?: string; task?: string; offset?: number; }
