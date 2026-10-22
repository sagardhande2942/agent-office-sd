/** Declarative, domain-neutral workflows supplied by a caller. No executable extensions. */
export interface ResultRule {
  path: string;
  type: 'string' | 'strings' | 'object' | 'integer' | 'value';
  equals?: string | number | boolean;
  enum?: string[];
  minItems?: number;
  when?: Record<string, string | number | boolean>;
}
export interface FileAttachment {
  path: string;
  content: string;
  sha256: string;
  maxBytes: number;
  when?: Record<string, string | number | boolean>;
}
export interface MeetingWorkflow {
  id: string;
  version: number;
  label: string;
  brief: string;
  roles: string[];
  memory: boolean;
  stages: { label: string; when?: { round: number; seat: number; field: string; equals: string | number | boolean }; turns: { seats: 'all' | number[]; prompt: string; output?: boolean }[] }[];
  result: { rules: ResultRule[]; attachments?: FileAttachment[] };
}
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
const text = (v: unknown, max: number): v is string => typeof v === 'string' && !!v.trim() && v.length <= max;
const field = (v: unknown): v is string => text(v, 120) && v.split('.').every(p => /^[a-zA-Z_][a-zA-Z0-9_]*$/.test(p) && !['__proto__', 'constructor', 'prototype'].includes(p));
const primitive = (v: unknown) => typeof v === 'string' || typeof v === 'boolean' || typeof v === 'number' && Number.isFinite(v);
const keys = (v: Record<string, unknown>, allowed: string[]) => Object.keys(v).every(k => allowed.includes(k));
const condition = (v: unknown) => v === undefined || record(v) && Object.keys(v).length <= 10 && Object.entries(v).every(([k,x]) => field(k) && primitive(x));
export function workflowProblem(value: unknown): string | undefined {
  if (!record(value) || !keys(value, ['id','version','label','brief','roles','memory','stages','result']) || JSON.stringify(value).length > 48000) return 'Invalid workflow object or size';
  const w = value;
  if (!text(w.id, 100) || !/^[a-z][a-z0-9.-]*$/.test(w.id) || !Number.isInteger(w.version) || Number(w.version) < 1 || Number(w.version) > 1000000
    || !text(w.label, 100) || !text(w.brief, 8000) || typeof w.memory !== 'boolean') return 'Invalid workflow identity or brief';
  if (!Array.isArray(w.roles) || w.roles.length < 1 || w.roles.length > 5 || w.roles.some(r => !text(r, 40))) return 'Workflow needs 1–5 named roles';
  if (!Array.isArray(w.stages) || !w.stages.length || w.stages.length > 8) return 'Workflow needs 1–8 stages';
  let final = 0;
  for (const [i, s] of w.stages.entries()) {
    if (!record(s) || !keys(s, ['label','turns','when']) || !text(s.label, 100) || !Array.isArray(s.turns) || !s.turns.length || s.turns.length > 5) return 'Invalid workflow stage';
    if (s.when !== undefined && (!record(s.when) || !keys(s.when, ['round','seat','field','equals']) || !Number.isInteger(s.when.round) || Number(s.when.round) < 1 || Number(s.when.round) > i
      || !Number.isInteger(s.when.seat) || Number(s.when.seat) < 0 || Number(s.when.seat) >= w.roles.length || !field(s.when.field) || !primitive(s.when.equals) || i === w.stages.length - 1)) return 'Invalid workflow stage condition';
    if (record(s.when)) {
      const producer = w.stages[Number(s.when.round) - 1];
      if (producer.when || !producer.turns.some((t: { seats: 'all' | number[] }) => t.seats === 'all' || t.seats.includes(Number((s.when as Record<string, unknown>).seat)))) return 'Condition must reference an unconditional producer seat';
    }
    const occupied = new Set<number>();
    for (const t of s.turns) {
      if (!record(t) || !keys(t, ['seats','prompt','output']) || !text(t.prompt, 8000) || t.output !== undefined && typeof t.output !== 'boolean') return 'Invalid workflow turn';
      const seats = t.seats === 'all' ? w.roles.map((_, j) => j) : t.seats;
      if (!Array.isArray(seats) || !seats.length || new Set(seats).size !== seats.length || seats.some(n => !Number.isInteger(n) || n < 0 || n >= (w.roles as unknown[]).length || occupied.has(n))) return 'Invalid or duplicate workflow seat';
      for (const n of seats) occupied.add(n);
      if (t.output) { if (i !== w.stages.length - 1 || seats.length !== 1 || seats[0] !== 0 || s.turns.length !== 1) return 'Only the final chair turn writes output'; final++; }
      if ([...t.prompt.matchAll(/\{\{([^{}]+)\}\}/g)].some(m => !/^(cwd|notes|output|report|meeting_id|workflow_id|workflow_version|role|round|note_[1-8]_[1-5]|notes_[1-8])$/.test(m[1]))) return 'Unknown workflow template variable';
    }
  }
  if (final !== 1) return 'Workflow needs one final chair output';
  if (!record(w.result) || !keys(w.result, ['rules','attachments']) || !Array.isArray(w.result.rules) || w.result.rules.length > 80) return 'Invalid workflow result rules';
  for (const r of w.result.rules) {
    if (!record(r) || !keys(r, ['path','type','equals','enum','minItems','when']) || !field(r.path)
      || !['string','strings','object','integer','value'].includes(String(r.type)) || !condition(r.when)
      || r.equals !== undefined && !primitive(r.equals) || r.enum !== undefined && (!Array.isArray(r.enum) || !r.enum.length || r.enum.length > 50 || r.enum.some(x => !text(x, 200)))
      || r.minItems !== undefined && (r.type !== 'strings' || !Number.isInteger(r.minItems) || Number(r.minItems) < 0 || Number(r.minItems) > 100)) return 'Invalid workflow result rule';
  }
  if (w.result.attachments !== undefined) {
    if (!Array.isArray(w.result.attachments) || w.result.attachments.length > 4) return 'Invalid workflow attachments';
    const targets = new Set<string>();
    for (const a of w.result.attachments) {
      if (!record(a) || !keys(a, ['path','content','sha256','maxBytes','when']) || !field(a.path) || !field(a.content) || !field(a.sha256) || !condition(a.when)
        || !Number.isInteger(a.maxBytes) || Number(a.maxBytes) < 1 || Number(a.maxBytes) > 200000 || new Set([a.path,a.content,a.sha256]).size !== 3
        || [...targets].some(p => a.content === p || String(a.content).startsWith(p+'.') || p.startsWith(a.content+'.'))) return 'Invalid workflow attachment';
      targets.add(a.content);
    }
  }
}
export function workflowValue(v: unknown, key: string): unknown {
  for (const part of key.split('.')) { if (!record(v) || !Object.hasOwn(v, part)) return; v = v[part]; }
  return v;
}
export function matches(v: unknown, when?: ResultRule['when']): boolean { return !when || Object.entries(when).every(([k,x]) => workflowValue(v,k) === x); }
export const DEFAULT_WORKFLOW: MeetingWorkflow = {
  id: 'team.review', version: 1, label: 'Team review', brief: 'Assess the supplied task and preserve disagreements. Work only in assigned notes.',
  roles: ['Chair', 'Reviewer'], memory: true,
  stages: [
    { label: 'Assessment', turns: [{ seats: 'all', prompt: 'Assess the task as {{role}}. Write your findings to the assigned note.' }] },
    { label: 'Synthesis', turns: [{ seats: [0], output: true, prompt: 'Read {{notes_1}}. Write the agreed result and unresolved questions.' }] },
  ], result: { rules: [{ path: 'summary', type: 'string' }] },
};
